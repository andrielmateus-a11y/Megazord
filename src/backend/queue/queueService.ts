// Fila central persistente (message_queue). O estado sobrevive ao fechamento do navegador e ao restart.
import { camel, db, type Queryable } from '../../db/dbClient.js';
import { channelLabel } from '../../shared/constants.js';
import { normalizePhone } from '../../shared/text.js';
import type { QueueItem } from '../../shared/types.js';
import { badRequest, notFound } from '../lib/errors.js';
import { log } from '../services/logService.js';
import { realtime } from '../services/realtime.js';

export interface EnqueueInput {
  accountId: number;
  userId: number | null;
  phone: string;
  leadId?: number | null;
  companyId?: number | null;
  contactId?: number | null;
  templateId?: number | null;
  body?: string | null;
  campaignId?: number | null;
  channelId?: number | null;
  kind?: 'activation' | 'followup' | 'manual';
  step?: number;
  priority?: number;
  scheduledAt?: Date;
}

export async function enqueue(q: Queryable, input: EnqueueInput): Promise<number> {
  const phone = normalizePhone(input.phone);
  if (!phone) throw badRequest('Telefone inválido.');
  if (!input.body && !input.templateId) throw badRequest('Informe a mensagem ou o template.');
  const [row] = await q.query(
    `INSERT INTO message_queue (account_id, campaign_id, lead_id, company_id, contact_id, template_id, phone, body,
       channel_mode, channel_id, kind, step, priority, scheduled_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14, now()),$15) RETURNING id`,
    [
      input.accountId, input.campaignId ?? null, input.leadId ?? null, input.companyId ?? null, input.contactId ?? null,
      input.templateId ?? null, phone, input.body ?? null, input.channelId ? 'manual' : 'auto', input.channelId ?? null,
      input.kind ?? 'activation', input.step ?? 1, input.priority ?? 0, input.scheduledAt ?? null, input.userId,
    ],
  );
  return row.id;
}

const SELECT = `
  SELECT q.*, c.name AS campaign_name, co.razao_social, co.nome_fantasia, ct.name AS contact_name, w.order_index
  FROM message_queue q
  LEFT JOIN campaigns c ON c.id = q.campaign_id
  LEFT JOIN companies co ON co.id = q.company_id
  LEFT JOIN contacts ct ON ct.id = q.contact_id
  LEFT JOIN whatsapp_channels w ON w.id = q.channel_id`;

function mapItem(row: any): QueueItem {
  const r = camel<any>(row);
  return {
    id: r.id,
    campaignId: r.campaignId,
    campaignName: r.campaignName,
    leadId: r.leadId,
    companyName: r.nomeFantasia || r.razaoSocial || null,
    contactName: r.contactName,
    phone: r.phone,
    channelMode: r.channelMode,
    channelId: r.channelId,
    channelLabel: r.orderIndex ? channelLabel(r.orderIndex) : null,
    kind: r.kind,
    status: r.status,
    attempts: r.attempts,
    scheduledAt: r.scheduledAt,
    processedAt: r.processedAt,
    lastError: r.lastError,
    skipReason: r.skipReason,
    createdAt: r.createdAt,
  };
}

export async function listQueue(accountId: number, f: { status?: string; campaignId?: number; limit?: number } = {}) {
  const where = ['q.account_id = $1'];
  const params: unknown[] = [accountId];
  if (f.status) {
    params.push(f.status);
    where.push(`q.status = $${params.length}`);
  }
  if (f.campaignId) {
    params.push(f.campaignId);
    where.push(`q.campaign_id = $${params.length}`);
  }
  params.push(Math.min(f.limit ?? 200, 1000));
  const rows = await db().query(
    `${SELECT} WHERE ${where.join(' AND ')}
     ORDER BY CASE WHEN q.status IN ('pending','processing') THEN 0 ELSE 1 END, q.priority DESC, q.scheduled_at, q.id DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows.map(mapItem);
}

export async function getQueueItem(accountId: number, id: number) {
  const row = await db().maybeOne(`${SELECT} WHERE q.account_id = $1 AND q.id = $2`, [accountId, id]);
  return row ? mapItem(row) : null;
}

export async function queueStats(accountId: number) {
  const rows = await db().query(
    `SELECT status, count(*)::int AS n FROM message_queue WHERE account_id = $1 GROUP BY status`,
    [accountId],
  );
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  return {
    pending: by.pending ?? 0,
    processing: by.processing ?? 0,
    sent: by.sent ?? 0,
    delivered: by.delivered ?? 0,
    read: by.read ?? 0,
    error: by.error ?? 0,
    cancelled: by.cancelled ?? 0,
    paused: by.paused ?? 0,
  };
}

export async function emitQueue(accountId: number) {
  realtime.emit(accountId, 'queue.updated', { stats: await queueStats(accountId) });
}

export async function cancelItem(accountId: number, userId: number, id: number) {
  const row = await db().maybeOne(
    `UPDATE message_queue SET status = 'cancelled', skip_reason = 'Cancelado pelo usuário' WHERE account_id = $1 AND id = $2
     AND status IN ('pending','paused','error') RETURNING id, campaign_id, lead_id`,
    [accountId, id],
  );
  if (!row) throw notFound('Item não encontrado ou já processado.');
  if (row.campaign_id) {
    await db().query(`UPDATE campaign_contacts SET status = 'cancelled' WHERE campaign_id = $1 AND lead_id = $2`, [row.campaign_id, row.lead_id]);
  }
  await log({ accountId, userId, category: 'queue', action: 'cancel', message: `Item #${id} cancelado` });
  await emitQueue(accountId);
}

export async function retryItem(accountId: number, userId: number, id: number) {
  const row = await db().maybeOne(
    `UPDATE message_queue SET status = 'pending', attempts = 0, last_error = NULL, skip_reason = NULL, scheduled_at = now()
     WHERE account_id = $1 AND id = $2 AND status IN ('error','cancelled','paused') RETURNING id`,
    [accountId, id],
  );
  if (!row) throw notFound('Item não encontrado ou não pode ser reenviado.');
  await log({ accountId, userId, category: 'queue', action: 'retry', message: `Item #${id} reenfileirado` });
  await emitQueue(accountId);
}

export async function pauseAll(accountId: number, userId: number, paused: boolean) {
  const rows = paused
    ? await db().query(`UPDATE message_queue SET status = 'paused' WHERE account_id = $1 AND status = 'pending' RETURNING id`, [accountId])
    : await db().query(`UPDATE message_queue SET status = 'pending' WHERE account_id = $1 AND status = 'paused' RETURNING id`, [accountId]);
  await log({ accountId, userId, category: 'queue', action: paused ? 'pause_all' : 'resume_all', message: `${rows.length} item(ns) ${paused ? 'pausado(s)' : 'retomado(s)'}` });
  await emitQueue(accountId);
  return rows.length;
}

export async function clearFinished(accountId: number) {
  const rows = await db().query(
    `DELETE FROM message_queue WHERE account_id = $1 AND status IN ('cancelled') RETURNING id`,
    [accountId],
  );
  await emitQueue(accountId);
  return rows.length;
}
