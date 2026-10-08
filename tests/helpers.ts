import request from 'supertest';
import { createApp } from '../src/backend/app';
import { db, initDb } from '../src/db/dbClient';
import { setTransport } from '../src/backend/services/transportRegistry';
import type { SendRequest } from '../src/backend/integrations/whatsapp/WhatsAppTransport';

export async function setup() {
  await initDb({ dataDir: 'memory' });
  const app = createApp();
  const res = await request(app).post('/api/auth/register').send({ name: 'Admin', email: 'admin@megazord.test', password: 'senha1234', companyName: 'Teste' });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  const token = res.body.token as string;
  const accountId = res.body.user.accountId as number;
  const userId = res.body.user.id as number;
  const agent = {
    get: (p: string) => request(app).get(p).set('Authorization', `Bearer ${token}`),
    post: (p: string, b?: object) => request(app).post(p).set('Authorization', `Bearer ${token}`).send(b ?? {}),
    patch: (p: string, b?: object) => request(app).patch(p).set('Authorization', `Bearer ${token}`).send(b ?? {}),
    put: (p: string, b?: object) => request(app).put(p).set('Authorization', `Bearer ${token}`).send(b ?? {}),
    del: (p: string) => request(app).delete(p).set('Authorization', `Bearer ${token}`),
  };
  return { app, token, accountId, userId, agent };
}

/** Transporte falso que registra por qual canal cada mensagem saiu. */
export function fakeTransport() {
  const sent: { channel: string; phone: string; text: string }[] = [];
  let counter = 0;
  let failNext: string | null = null;
  const transport = {
    name: 'evolution' as const,
    async send(req: SendRequest) {
      if (failNext) {
        const msg = failNext;
        failNext = null;
        const { TransportError } = await import('../src/backend/integrations/whatsapp/WhatsAppTransport');
        throw new TransportError(msg, true, true);
      }
      sent.push({ channel: req.channel.label, phone: req.phone, text: req.text });
      return { externalId: `ext-${++counter}`, containerName: null };
    },
  };
  setTransport('evolution', transport);
  return { sent, failOnce: (m: string) => (failNext = m) };
}

/** Coloca os canais em modo Evolution conectado, sem cooldown (para testar o rodízio). */
export async function connectChannels(accountId: number) {
  const rows = await db().query('SELECT id, order_index FROM whatsapp_channels WHERE account_id = $1', [accountId]);
  for (const r of rows) {
    await db().query(
      `UPDATE whatsapp_channels SET transport = 'evolution', evolution_instance = $2, status = 'connected', cooldown_seconds = 0, daily_limit = 1000 WHERE id = $1`,
      [r.id, `inst-${accountId}-${r.order_index}`],
    );
  }
}

let seq = 0;
/** Cria empresa + sócio com celular + lead. */
export async function createLead(accountId: number, opts: { phone?: string; name?: string; company?: string } = {}) {
  seq++;
  const cnpj = String(10000000000000 + seq * 7919).slice(0, 14);
  const phone = opts.phone ?? `55119${String(80000000 + seq).padStart(8, '0')}`;
  const company = await db().one(
    `INSERT INTO companies (account_id, cnpj, razao_social, cidade, uf, enrichment_status) VALUES ($1,$2,$3,'SAO PAULO','SP','found') RETURNING id`,
    [accountId, cnpj, opts.company ?? `EMPRESA ${seq} CONTABILIDADE LTDA`],
  );
  const contact = await db().one(
    `INSERT INTO contacts (account_id, company_id, name, phone, phone_type, is_primary, source) VALUES ($1,$2,$3,$4,'celular',true,'test') RETURNING id`,
    [accountId, company.id, opts.name ?? `SOCIO NUMERO ${seq}`, phone],
  );
  const lead = await db().one('INSERT INTO leads (account_id, company_id, contact_id) VALUES ($1,$2,$3) RETURNING id', [accountId, company.id, contact.id]);
  return { companyId: company.id as number, contactId: contact.id as number, leadId: lead.id as number, phone, cnpj };
}
