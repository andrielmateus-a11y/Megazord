import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/dbClient';
import { tick } from '../src/backend/queue/worker';
import { connectChannels, createLead, fakeTransport, setup } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let transport: ReturnType<typeof fakeTransport>;

beforeAll(async () => {
  ctx = await setup();
  transport = fakeTransport();
});

afterEach(() => vi.unstubAllGlobals());

describe('autenticação e autorização', () => {
  it('rejeita senha errada e rotas sem token', async () => {
    await request(ctx.app).post('/api/auth/login').send({ email: 'admin@megazord.test', password: 'errada123' }).expect(401);
    await request(ctx.app).get('/api/leads').expect(401);
    const ok = await request(ctx.app).post('/api/auth/login').send({ email: 'admin@megazord.test', password: 'senha1234' }).expect(200);
    expect(ok.body.user.role).toBe('admin');
    expect(ok.body.user.password_hash).toBeUndefined();
  });

  it('cadastro público fica fechado após o primeiro administrador', async () => {
    const res = await request(ctx.app).post('/api/auth/register').send({ name: 'Outro', email: 'x@y.com', password: 'senha1234' });
    expect(res.status).toBe(403);
  });

  it('SDR não acessa rotas de administrador', async () => {
    await ctx.agent.post('/api/users', { name: 'Sdr Um', email: 'sdr@megazord.test', password: 'senha1234', role: 'sdr' }).expect(201);
    const login = await request(ctx.app).post('/api/auth/login').send({ email: 'sdr@megazord.test', password: 'senha1234' });
    const sdr = login.body.token;
    await request(ctx.app).put('/api/casa-dos-dados/key').set('Authorization', `Bearer ${sdr}`).send({ apiKey: 'abcdefghij' }).expect(403);
    await request(ctx.app).post('/api/whatsapp/channels').set('Authorization', `Bearer ${sdr}`).expect(403);
    await request(ctx.app).get('/api/leads').set('Authorization', `Bearer ${sdr}`).expect(200);
  });
});

describe('canais WA 01..WA 08', () => {
  it('começa com 4, o + adiciona em sequência até 8 e bloqueia o nono', async () => {
    let res = await ctx.agent.get('/api/whatsapp/channels').expect(200);
    expect(res.body.channels.map((c: any) => c.label)).toEqual(['WA 01', 'WA 02', 'WA 03', 'WA 04']);
    expect(res.body.channels.map((c: any) => c.container.name)).toEqual(['MEGAZORD WA 01', 'MEGAZORD WA 02', 'MEGAZORD WA 03', 'MEGAZORD WA 04']);
    for (const expected of ['WA 05', 'WA 06', 'WA 07', 'WA 08']) {
      res = await ctx.agent.post('/api/whatsapp/channels').expect(201);
      expect(res.body.channels.at(-1).label).toBe(expected);
      expect(res.body.channels.at(-1).container.name).toBe(`MEGAZORD ${expected}`);
    }
    const ninth = await ctx.agent.post('/api/whatsapp/channels');
    expect(ninth.status).toBe(409);
  });
});

describe('Casa dos Dados + prospecção', () => {
  it('a chave é salva criptografada e nunca volta em texto puro', async () => {
    const res = await ctx.agent.put('/api/casa-dos-dados/key', { apiKey: 'cdd-secret-key-123456' }).expect(200);
    expect(res.body.masked).toBe('••••••••3456');
    expect(JSON.stringify(res.body)).not.toContain('cdd-secret-key');
    const row = await db().one(`SELECT encrypted_value FROM api_credentials WHERE provider = 'casa_dos_dados'`);
    expect(row.encrypted_value).not.toContain('cdd-secret');
    const logs = await db().query(`SELECT meta::text AS m, message FROM system_logs`);
    expect(logs.some((l) => (l.m ?? '').includes('cdd-secret') || (l.message ?? '').includes('cdd-secret'))).toBe(false);
  });

  it('Descobrir novos não repete empresas já apresentadas (deduplicação no armazenamento)', async () => {
    const page = (cnpjs: string[]) => ({
      total: 3,
      cnpjs: cnpjs.map((c, i) => ({ cnpj: c, razao_social: `ESCRITORIO ${i} CONTABIL LTDA`, situacao_cadastral: { situacao_atual: 'ATIVA' }, endereco: { municipio: 'SAO PAULO', uf: 'SP' }, porte_empresa: { descricao: 'MICRO EMPRESA' } })),
    });
    const fetchMock = vi.fn(async (url: string, init: any) => {
      expect(init.headers['api-key']).toBe('cdd-secret-key-123456');
      const body = JSON.parse(init.body);
      const cnpjs = body.pagina === 1 ? ['11222333000181', '45723174000110', '11444777000161'] : [];
      return new Response(JSON.stringify(page(cnpjs)), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = await ctx.agent.post('/api/companies/discover', { uf: 'SP', count: 2 }).expect(200);
    expect(first.body.results).toHaveLength(2);
    const second = await ctx.agent.post('/api/companies/discover/next', { count: 20 }).expect(200);
    const seen = [...first.body.results, ...second.body.results].map((r: any) => r.company.cnpj);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(3);
    const again = await ctx.agent.post('/api/companies/discover', { uf: 'SP', count: 20 }).expect(200);
    expect(again.body.results).toHaveLength(0);
    expect(again.body.skippedDuplicates).toBe(3);
  });

  it('Trazer contatos identifica sócio + celular e cria o lead; erro ≠ não encontrado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        cnpj: '11222333000181',
        razao_social: 'ESCRITORIO 0 CONTABIL LTDA',
        quadro_societario: [{ nome: 'JOAO DA SILVA', qualificacao_socio: 'Sócio-Administrador' }],
        contato_telefonico: [{ completo: '(11) 3333-4444', tipo: 'fixo' }, { completo: '(11) 99999-1111', tipo: 'celular' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ));
    const res = await ctx.agent.post('/api/companies/11222333000181/contacts/fetch', { source: 'casa_dos_dados' }).expect(200);
    expect(res.body.status).toBe('found');
    expect(res.body.result.primaryContact).toMatchObject({ name: 'JOAO DA SILVA', phone: '5511999991111' });
    expect(res.body.result.lead.status).toBe('novo');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"boom"}', { status: 500 })));
    const err = await ctx.agent.post('/api/companies/45723174000110/contacts/fetch', { source: 'casa_dos_dados' });
    expect(err.status).toBe(502);
    const company = await db().one(`SELECT enrichment_status FROM companies WHERE cnpj = '45723174000110'`);
    expect(company.enrichment_status).toBe('error');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    const nf = await ctx.agent.post('/api/companies/11444777000161/contacts/fetch', { source: 'casa_dos_dados' }).expect(200);
    expect(nf.body.status).toBe('not_found');
    expect(nf.body.result.company.enrichmentStatus).toBe('not_found');
  });

  it('"Já usamos este CNPJ?" responde com o histórico', async () => {
    const res = await ctx.agent.get('/api/companies/check/11.222.333%2F0001-81').expect(200);
    expect(res.body.company).toBeTruthy();
    expect(res.body.used).toBe(false);
    const unknown = await ctx.agent.get('/api/companies/check/06990590000123').expect(200);
    expect(unknown.body.company).toBeNull();
  });
});

describe('ativação e campanhas', () => {
  it('envio de ativação a partir do lead (pré-visualização + envio)', async () => {
    await connectChannels(ctx.accountId);
    const lead = await db().one(`SELECT l.id FROM leads l JOIN companies c ON c.id = l.company_id WHERE c.cnpj = '11222333000181'`);
    const preview = await ctx.agent.post('/api/whatsapp/messages/activation/preview', { leadId: lead.id, templateId: 1 }).expect(200);
    expect(preview.body.message).toContain('Olá, Joao!');
    expect(preview.body.eligibility.ok).toBe(true);
    expect(preview.body.channel.label).toBe('WA 01');
    const sent = await ctx.agent.post('/api/whatsapp/messages/activation/send', { leadId: lead.id, templateId: 1 }).expect(200);
    expect(sent.body).toMatchObject({ status: 'sent', channelLabel: 'WA 01' });
    const blocked = await ctx.agent.post('/api/whatsapp/messages/activation/send', { leadId: lead.id, templateId: 1 });
    expect(blocked.status).toBe(400);
  });

  it('campanha: pré-visualiza, inicia e o worker respeita o intervalo', async () => {
    for (let i = 0; i < 3; i++) await createLead(ctx.accountId);
    const body = {
      name: 'Ativação Contadores SP',
      templateId: 1,
      audience: { statuses: ['novo'], onlyNeverContacted: true },
      channelIds: [1, 2],
      windowStart: '00:00',
      windowEnd: '23:59',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      intervalSeconds: 3600,
      dailyLimit: 100,
      cadence: [{ step: 2, dayOffset: 3, templateId: 3 }],
    };
    const preview = await ctx.agent.post('/api/campaigns/preview', body).expect(200);
    expect(preview.body.audienceCount).toBeGreaterThanOrEqual(3);
    expect(preview.body.samples[0].channel.label).toMatch(/WA 0[12]/);
    const created = await ctx.agent.post('/api/campaigns', body).expect(201);
    const started = await ctx.agent.post(`/api/campaigns/${created.body.campaign.id}/start`).expect(200);
    expect(started.body.campaign.status).toBe('running');
    transport.sent.length = 0;
    await tick();
    await tick();
    expect(transport.sent).toHaveLength(1); // intervalo de 3600s: apenas 1 envio
    expect(['WA 01', 'WA 02']).toContain(transport.sent[0].channel);
    const followups = await db().query(`SELECT scheduled_at FROM message_queue WHERE campaign_id = $1 AND kind = 'followup'`, [created.body.campaign.id]);
    expect(followups).toHaveLength(1);
    const paused = await ctx.agent.post(`/api/campaigns/${created.body.campaign.id}/pause`).expect(200);
    expect(paused.body.campaign.status).toBe('paused');
  });
});

describe('webhooks', () => {
  it('Evolution: recebe resposta, vincula ao lead, é idempotente e exige token', async () => {
    const lead = await db().one(`SELECT l.id, ct.phone FROM leads l JOIN contacts ct ON ct.id = l.contact_id JOIN companies c ON c.id = l.company_id WHERE c.cnpj = '11222333000181'`);
    const event = {
      event: 'messages.upsert',
      instance: `inst-${ctx.accountId}-1`,
      date_time: new Date().toISOString(),
      data: { key: { remoteJid: `${lead.phone}@s.whatsapp.net`, fromMe: false, id: 'MSG-ABC-1' }, pushName: 'João', message: { conversation: 'Oi! Tenho interesse.' }, messageTimestamp: Math.floor(Date.now() / 1000) },
    };
    await request(ctx.app).post('/api/webhook/evolution').send(event).expect(401);
    const a = await request(ctx.app).post('/api/webhook/evolution?token=test-webhook-secret-123').send(event).expect(200);
    const b = await request(ctx.app).post('/api/webhook/evolution?token=test-webhook-secret-123').send(event).expect(200);
    expect(a.body.processed).toBe(true);
    expect(b.body).toMatchObject({ processed: false, reason: 'duplicado' });
    const msgs = await db().query(`SELECT * FROM messages WHERE external_id = 'MSG-ABC-1'`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].lead_id).toBe(lead.id);
    const l = await db().one('SELECT status, last_reply_at FROM leads WHERE id = $1', [lead.id]);
    expect(l.status).toBe('em_contato');
    expect(l.last_reply_at).toBeTruthy();
  });

  it('Evolution: atualiza status entregue/lida', async () => {
    const msg = await db().one(`SELECT external_id FROM messages WHERE direction = 'out' AND external_id IS NOT NULL ORDER BY id LIMIT 1`);
    await request(ctx.app)
      .post('/api/webhook/evolution?token=test-webhook-secret-123')
      .send({ event: 'messages.update', instance: `inst-${ctx.accountId}-1`, data: { keyId: msg.external_id, status: 'READ' } })
      .expect(200);
    const after = await db().one('SELECT status, read_at FROM messages WHERE external_id = $1', [msg.external_id]);
    expect(after.status).toBe('read');
  });
});

describe('importação e exportação', () => {
  it('importa histórico CSV e exporta leads em CSV/Excel', async () => {
    const csv = 'cnpj;razao_social;socio;telefone;status\n06.990.590/0001-23;ANTIGA CONTABIL;PEDRO;11988887777;Sem interesse\n00000000000000;X;Y;1;novo\n';
    const imp = await ctx.agent.post('/api/settings/import/leads', { fileName: 'h.csv', contentBase64: Buffer.from(csv).toString('base64') }).expect(200);
    expect(imp.body.created).toBe(1);
    expect(imp.body.errors).toHaveLength(1);
    const lead = await db().one(`SELECT l.status FROM leads l JOIN companies c ON c.id = l.company_id WHERE c.cnpj = '06990590000123'`);
    expect(lead.status).toBe('sem_interesse');
    const exp = await ctx.agent.get('/api/settings/export/leads?format=csv').expect(200);
    expect(exp.text).toContain('ANTIGA CONTABIL');
    const xlsx = await ctx.agent.get('/api/settings/export/leads?format=xlsx').buffer(true).expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
  });
});
