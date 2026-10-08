// Envio (ativação e manual), mensagens recebidas e atualização de status.
import { db } from '../../db/dbClient.js';
import { normalizePhone, renderTemplate, missingVariables } from '../../shared/text.js';
import { badRequest, notFound } from '../lib/errors.js';
import { companyRepository } from '../repositories/companyRepository.js';
import { chatRepository } from '../repositories/chatRepository.js';
import { historyRepository, leadRepository } from '../repositories/leadRepository.js';
import { channelRepository } from '../repositories/channelRepository.js';
import { enqueue, emitQueue } from '../queue/queueService.js';
import { processItem } from '../queue/worker.js';
import { checkEligibility } from './eligibilityService.js';
import { log } from './logService.js';
import { realtime } from './realtime.js';
import { rotationOverview } from './rotationService.js';
import { emitChannels } from './channelService.js';

async function leadVars(accountId: number, leadId: number, contactId?: number | null) {
  const lead = await leadRepository.findById(accountId, leadId);
  if (!lead) throw notFound('Lead não encontrado.');
  const contact = contactId ? await companyRepository.findContact(accountId, contactId) : lead.contact;
  return {
    lead,
    contact,
    vars: {
      socio: contact?.name ?? null,
      empresa: lead.company.nomeFantasia || lead.company.razaoSocial,
      telefone: contact?.phone ?? null,
      cidade: lead.company.cidade,
      cnpj: lead.company.cnpj,
    },
  };
}

/** Pré-visualização: mensagem personalizada + canal previsto + container + próximo. */
export async function previewActivation(accountId: number, input: { leadId: number; contactId?: number | null; templateId?: number | null; body?: string | null; channelId?: number | null }) {
  const { lead, contact, vars } = await leadVars(accountId, input.leadId, input.contactId);
  const template = input.templateId
    ? await db().maybeOne('SELECT body FROM message_templates WHERE account_id = $1 AND id = $2', [accountId, input.templateId])
    : null;
  const body = input.body ?? template?.body ?? '';
  const eligibility = contact?.phone
    ? await checkEligibility({ accountId, phone: contact.phone, leadId: lead.id, kind: 'activation' })
    : { ok: false, reason: 'Contato sem telefone' };
  const rotation = await rotationOverview(accountId, null, 2);
  let predicted = rotation.nextChannel;
  if (input.channelId) {
    const ch = await channelRepository.findById(accountId, input.channelId);
    predicted = ch ? { id: ch.id, label: ch.label, container: ch.container?.name ?? null } : null;
  }
  return {
    company: lead.company.nomeFantasia || lead.company.razaoSocial,
    socio: contact?.name ?? null,
    phone: contact?.phone ?? null,
    message: renderTemplate(body, vars),
    missingVariables: missingVariables(body, vars),
    eligibility,
    channel: predicted,
    next: input.channelId ? rotation.nextChannel : rotation.sequence[1] ?? null,
  };
}

/** Envia a mensagem de ativação de um lead (fila com prioridade + processamento imediato). */
export async function sendActivation(
  accountId: number,
  userId: number,
  input: { leadId: number; contactId?: number | null; templateId?: number | null; body?: string | null; channelId?: number | null },
) {
  const { lead, contact } = await leadVars(accountId, input.leadId, input.contactId);
  const phone = normalizePhone(contact?.phone);
  if (!phone) throw badRequest('O contato não possui celular. Use "Trazer contatos" ou adicione manualmente.');
  const eligibility = await checkEligibility({ accountId, phone, leadId: lead.id, kind: 'activation' });
  if (!eligibility.ok) {
    await log({ accountId, userId, level: 'warn', category: 'queue', action: 'blocked', message: `Não enviado: ${eligibility.reason}`, meta: { leadId: lead.id, phone } });
    throw badRequest(`Não enviado: ${eligibility.reason}.`);
  }
  const queueId = await enqueue(db(), {
    accountId,
    userId,
    phone,
    leadId: lead.id,
    companyId: lead.companyId,
    contactId: contact?.id ?? null,
    templateId: input.templateId ?? null,
    body: input.body ?? null,
    channelId: input.channelId ?? null,
    kind: 'activation',
    priority: 100,
  });
  await leadRepository.update(accountId, lead.id, { status: lead.status === 'novo' ? 'em_contato' : lead.status });
  await emitQueue(accountId);
  const outcome = await processItem(queueId);
  return { queueId, ...outcome };
}

/** Resposta manual no Inbox (canal escolhido ou automático). */
export async function sendManual(
  accountId: number,
  userId: number,
  input: { chatId?: number; phone?: string; leadId?: number | null; body: string; channelId?: number | null },
) {
  let phone: string | null = null;
  let leadId = input.leadId ?? null;
  let contactId: number | null = null;
  let companyId: number | null = null;
  let channelId = input.channelId ?? null;
  if (input.chatId) {
    const chat = await chatRepository.findById(accountId, input.chatId);
    if (!chat) throw notFound('Conversa não encontrada.');
    phone = chat.remotePhone;
    leadId = chat.leadId;
    contactId = chat.contactId;
    if (input.channelId === undefined) channelId = chat.channelId;
  } else {
    phone = normalizePhone(input.phone);
  }
  if (!phone) throw badRequest('Telefone inválido.');
  if (leadId) {
    const lead = await leadRepository.findById(accountId, leadId);
    companyId = lead?.companyId ?? null;
    contactId = contactId ?? lead?.contactId ?? null;
  }
  const queueId = await enqueue(db(), {
    accountId,
    userId,
    phone,
    leadId,
    companyId,
    contactId,
    body: input.body,
    channelId,
    kind: 'manual',
    priority: 200,
  });
  const outcome = await processItem(queueId);
  if (outcome.status === 'error' && input.chatId) {
    // Registra a falha visível na conversa.
    await db().tx(async (q) => {
      await chatRepository.insertMessage(q, { accountId, chatId: input.chatId!, direction: 'out', body: input.body, status: 'failed', userId, channelId, queueItemId: queueId, error: outcome.reason ?? null });
    });
    realtime.emit(accountId, 'chat.updated', { chatId: input.chatId });
  }
  return { queueId, ...outcome };
}

// ------------------------------------------------------------------ Entrada (webhooks)

export async function handleIncoming(input: {
  accountId: number;
  channelId: number;
  phone: string;
  name?: string | null;
  body: string | null;
  externalId?: string | null;
  fromMe: boolean;
  timestamp?: Date;
  media?: unknown;
  transport: string;
}) {
  const phone = normalizePhone(input.phone);
  if (!phone) return null;
  if (input.externalId) {
    const dup = await db().maybeOne('SELECT id FROM messages WHERE external_id = $1 AND channel_id = $2', [input.externalId, input.channelId]);
    if (dup) return dup.id as number;
  }
  const contact = await companyRepository.findContactByPhone(input.accountId, phone);
  const lead = contact?.companyId ? await leadRepository.findByCompany(input.accountId, contact.companyId) : null;

  if (input.fromMe) {
    // Mensagem enviada por nós (ex.: Firefox Container) que voltou pelo webhook da Evolution:
    // vincula ao registro existente em vez de duplicar.
    const existing = await db().maybeOne(
      `SELECT m.id FROM messages m JOIN chats c ON c.id = m.chat_id
       WHERE c.channel_id = $1 AND c.remote_phone = $2 AND m.direction = 'out' AND m.external_id IS NULL
         AND m.body = $3 AND m.created_at > now() - interval '15 minutes' ORDER BY m.id DESC LIMIT 1`,
      [input.channelId, phone, input.body],
    );
    if (existing) {
      await db().query('UPDATE messages SET external_id = $2 WHERE id = $1', [existing.id, input.externalId ?? null]);
      return existing.id as number;
    }
  }

  const result = await db().tx(async (q) => {
    const chatId = await chatRepository.upsert(q, input.accountId, input.channelId, phone, {
      leadId: lead?.id ?? null,
      contactId: contact?.id ?? null,
      name: input.fromMe ? null : input.name ?? contact?.name ?? null,
    });
    const messageId = await chatRepository.insertMessage(q, {
      accountId: input.accountId,
      chatId,
      direction: input.fromMe ? 'out' : 'in',
      body: input.body,
      status: input.fromMe ? 'sent' : 'received',
      companyId: lead?.companyId ?? null,
      contactId: contact?.id ?? null,
      leadId: lead?.id ?? null,
      channelId: input.channelId,
      transport: input.transport,
      externalId: input.externalId ?? null,
      media: input.media,
      createdAt: input.timestamp,
    });
    await chatRepository.touch(q, chatId, input.body ?? '[mídia]', !input.fromMe);
    if (!input.fromMe) {
      await q.query('UPDATE whatsapp_channels SET received_count = received_count + 1 WHERE id = $1', [input.channelId]);
      if (lead) {
        await leadRepository.registerReply(q, lead.id);
        await historyRepository.add(q, { accountId: input.accountId, leadId: lead.id, companyId: lead.companyId, channelId: input.channelId, type: 'reply_received', description: 'Resposta recebida no WhatsApp' });
      }
    }
    return { chatId, messageId };
  });

  if (!input.fromMe && lead) {
    // Respondeu → cancela follow-ups pendentes da cadência.
    await db().query(
      `UPDATE message_queue SET status = 'cancelled', skip_reason = 'Contato respondeu — sequência cancelada'
       WHERE lead_id = $1 AND kind = 'followup' AND status IN ('pending','paused')`,
      [lead.id],
    );
    realtime.emit(input.accountId, 'lead.updated', { leadId: lead.id });
  }
  const message = await chatRepository.messageById(result.messageId);
  realtime.emit(input.accountId, 'message.new', { message });
  realtime.emit(input.accountId, 'chat.updated', { chatId: result.chatId });
  if (!input.fromMe) await emitChannels(input.accountId);
  return result.messageId;
}

const STATUS_RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };

export async function updateMessageStatus(externalId: string, status: 'sent' | 'delivered' | 'read' | 'failed') {
  const msg = await db().maybeOne('SELECT id, account_id, status, queue_item_id, chat_id FROM messages WHERE external_id = $1 ORDER BY id DESC LIMIT 1', [externalId]);
  if (!msg) return;
  if (status !== 'failed' && (STATUS_RANK[status] ?? 0) <= (STATUS_RANK[msg.status] ?? 0)) return;
  await db().query(
    `UPDATE messages SET status = $2,
       delivered_at = CASE WHEN $2 IN ('delivered','read') THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
       read_at = CASE WHEN $2 = 'read' THEN now() ELSE read_at END WHERE id = $1`,
    [msg.id, status],
  );
  if (msg.queue_item_id && status !== 'sent') {
    await db().query(`UPDATE message_queue SET status = $2 WHERE id = $1 AND status IN ('sent','delivered')`, [msg.queue_item_id, status === 'failed' ? 'error' : status]);
    await emitQueue(msg.account_id);
  }
  realtime.emit(msg.account_id, 'message.status', { messageId: msg.id, chatId: msg.chat_id, status });
}
