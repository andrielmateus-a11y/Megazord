import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/dbClient';
import { processItem } from '../src/backend/queue/worker';
import { enqueue } from '../src/backend/queue/queueService';
import { connectChannels, createLead, fakeTransport, setup } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let transport: ReturnType<typeof fakeTransport>;

async function sendTo(leadIdx: { leadId: number; phone: string; companyId: number; contactId: number }) {
  const id = await enqueue(db(), {
    accountId: ctx.accountId,
    userId: ctx.userId,
    phone: leadIdx.phone,
    leadId: leadIdx.leadId,
    companyId: leadIdx.companyId,
    contactId: leadIdx.contactId,
    templateId: 1,
    kind: 'activation',
  });
  return processItem(id);
}

describe('fila + rodízio persistente', () => {
  beforeAll(async () => {
    ctx = await setup();
    transport = fakeTransport();
    await connectChannels(ctx.accountId);
  });

  it('distribui 1 → 2 → 3 → 4 → 1 e personaliza a mensagem', async () => {
    for (let i = 0; i < 5; i++) await sendTo(await createLead(ctx.accountId, { name: 'MARIA SOUZA' }));
    expect(transport.sent.map((s) => s.channel)).toEqual(['WA 01', 'WA 02', 'WA 03', 'WA 04', 'WA 01']);
    expect(transport.sent[0].text).toContain('Olá, Maria!');
    const pointer = await db().one('SELECT last_order_index FROM rotation_state WHERE account_id = $1', [ctx.accountId]);
    expect(pointer.last_order_index).toBe(1);
  });

  it('pula canal pausado e retorna a ele quando reativado', async () => {
    transport.sent.length = 0;
    await ctx.agent.post('/api/whatsapp/channels/3/pause').expect(200);
    for (let i = 0; i < 3; i++) await sendTo(await createLead(ctx.accountId));
    expect(transport.sent.map((s) => s.channel)).toEqual(['WA 02', 'WA 04', 'WA 01']);
    await ctx.agent.post('/api/whatsapp/channels/3/resume').expect(200);
    transport.sent.length = 0;
    for (let i = 0; i < 2; i++) await sendTo(await createLead(ctx.accountId));
    expect(transport.sent.map((s) => s.channel)).toEqual(['WA 02', 'WA 03']);
  });

  it('inclui novos canais (+) no ciclo', async () => {
    await ctx.agent.post('/api/whatsapp/channels').expect(201);
    await connectChannels(ctx.accountId);
    transport.sent.length = 0;
    for (let i = 0; i < 3; i++) await sendTo(await createLead(ctx.accountId));
    expect(transport.sent.map((s) => s.channel)).toEqual(['WA 04', 'WA 05', 'WA 01']);
  });

  it('registra mensagem, conversa, lead e histórico vinculados', async () => {
    const lead = await createLead(ctx.accountId);
    const out = await sendTo(lead);
    expect(out.status).toBe('sent');
    const msg = await db().one('SELECT * FROM messages WHERE id = $1', [out.messageId]);
    expect(msg.lead_id).toBe(lead.leadId);
    expect(msg.company_id).toBe(lead.companyId);
    expect(msg.channel_id).toBe(out.channelId);
    expect(msg.transport).toBe('evolution');
    const l = await db().one('SELECT status, contact_count, last_channel_id FROM leads WHERE id = $1', [lead.leadId]);
    expect(l).toMatchObject({ status: 'aguardando_resposta', contact_count: 1, last_channel_id: out.channelId });
    const chats = await ctx.agent.get('/api/whatsapp/chats').expect(200);
    expect(chats.body.chats.some((c: any) => c.leadId === lead.leadId && c.channelLabel === out.channelLabel)).toBe(true);
  });

  it('não envia duas vezes para o mesmo telefone/CNPJ e registra o motivo', async () => {
    const lead = await createLead(ctx.accountId);
    expect((await sendTo(lead)).status).toBe('sent');
    const again = await sendTo(lead);
    expect(again.status).toBe('skipped');
    expect(again.reason).toMatch(/já/i);
  });

  it('respeita opt-out e "Não contatar"', async () => {
    const a = await createLead(ctx.accountId);
    await ctx.agent.post('/api/leads/opt-outs', { phone: a.phone }).expect(201);
    expect((await sendTo(a)).reason).toBe('Contato em opt-out');
    const b = await createLead(ctx.accountId);
    await ctx.agent.patch(`/api/leads/${b.leadId}`, { doNotContact: true }).expect(200);
    expect((await sendTo(b)).reason).toMatch(/Não contatar/);
  });

  it('erro de canal reagenda o item e tenta outro número', async () => {
    transport.sent.length = 0;
    transport.failOnce('Instância caiu');
    const lead = await createLead(ctx.accountId);
    const first = await sendTo(lead);
    expect(first.status).toBe('rescheduled');
    const item = await db().one(`SELECT id, status FROM message_queue WHERE lead_id = $1`, [lead.leadId]);
    expect(item.status).toBe('pending');
    await db().query('UPDATE message_queue SET scheduled_at = now() WHERE id = $1', [item.id]);
    const second = await processItem(item.id);
    expect(second.status).toBe('sent');
    expect(second.channelId).not.toBe(first.channelId);
  });

  it('sem canal disponível, o item permanece na fila (não perde o lead)', async () => {
    await db().query(`UPDATE whatsapp_channels SET status = 'disconnected' WHERE account_id = $1`, [ctx.accountId]);
    const lead = await createLead(ctx.accountId);
    const out = await sendTo(lead);
    expect(out.status).toBe('rescheduled');
    const item = await db().one(`SELECT status, attempts FROM message_queue WHERE lead_id = $1`, [lead.leadId]);
    expect(item).toMatchObject({ status: 'pending', attempts: 0 });
    await connectChannels(ctx.accountId);
  });
});
