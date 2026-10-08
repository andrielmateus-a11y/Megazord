// Webhooks (Evolution e genérico WhatsApp) com idempotência / anti-replay.
import { db } from '../../db/dbClient.js';
import { sha256 } from '../lib/crypto.js';
import { phoneFromJid } from '../integrations/evolution/EvolutionClient.js';
import { channelRepository } from '../repositories/channelRepository.js';
import { emitChannels } from './channelService.js';
import { log } from './logService.js';
import { handleIncoming, updateMessageStatus } from './messageService.js';
import { realtime } from './realtime.js';

const MAX_EVENT_AGE_MS = 24 * 3600 * 1000;

/** Registra o evento; devolve false se já foi processado (idempotência). */
export async function claimEvent(source: string, key: string): Promise<boolean> {
  const rows = await db().query(
    `INSERT INTO webhook_events (source, event_key) VALUES ($1,$2) ON CONFLICT (source, event_key) DO NOTHING RETURNING id`,
    [source, key.slice(0, 200)],
  );
  return rows.length > 0;
}

export async function purgeOldEvents() {
  await db().query(`DELETE FROM webhook_events WHERE received_at < now() - interval '7 days'`);
}

function textOf(message: any): string | null {
  if (!message) return null;
  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.imageMessage?.caption ??
    message.videoMessage?.caption ??
    message.documentMessage?.caption ??
    message.buttonsResponseMessage?.selectedDisplayText ??
    message.listResponseMessage?.title ??
    null
  );
}

function mediaOf(message: any): unknown {
  if (!message) return null;
  for (const type of ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']) {
    if (message[type]) return { type: type.replace('Message', ''), mimetype: message[type].mimetype ?? null, fileName: message[type].fileName ?? null };
  }
  return null;
}

const STATUS_MAP: Record<string, 'sent' | 'delivered' | 'read' | 'failed'> = {
  SERVER_ACK: 'sent',
  DELIVERY_ACK: 'delivered',
  READ: 'read',
  PLAYED: 'read',
  ERROR: 'failed',
  '2': 'sent',
  '3': 'delivered',
  '4': 'read',
  '5': 'read',
};

/** Processa um evento da Evolution API. */
export async function handleEvolutionEvent(body: any): Promise<{ processed: boolean; reason?: string }> {
  const event = String(body?.event ?? '').toLowerCase().replace(/_/g, '.');
  const instance = String(body?.instance ?? body?.instanceName ?? '');
  if (!event || !instance) return { processed: false, reason: 'evento inválido' };

  const when = Date.parse(body?.date_time ?? '');
  if (Number.isFinite(when) && Date.now() - when > MAX_EVENT_AGE_MS) return { processed: false, reason: 'evento antigo (replay)' };

  const dataList = Array.isArray(body.data) ? body.data : [body.data];
  const keyBase = dataList.map((d: any) => `${d?.key?.id ?? d?.keyId ?? d?.messageId ?? ''}:${d?.status ?? d?.state ?? ''}`).join('|');
  const eventKey = sha256(`${instance}:${event}:${keyBase || JSON.stringify(body.data ?? {})}`);
  if (!(await claimEvent('evolution', eventKey))) return { processed: false, reason: 'duplicado' };

  const channel = await channelRepository.findByInstance(instance);
  if (!channel) return { processed: false, reason: 'instância não vinculada' };
  const accountId = channel.accountId;

  switch (event) {
    case 'messages.upsert':
    case 'send.message': {
      for (const d of dataList) {
        const jid: string = d?.key?.remoteJid ?? '';
        if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;
        const ts = Number(d.messageTimestamp);
        await handleIncoming({
          accountId,
          channelId: channel.id,
          phone: phoneFromJid(d?.key?.remoteJidAlt ?? jid) ?? '',
          name: d.pushName ?? null,
          body: textOf(d.message),
          media: mediaOf(d.message),
          externalId: d?.key?.id ?? null,
          fromMe: !!d?.key?.fromMe || event === 'send.message',
          timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : undefined,
          transport: 'evolution',
        });
      }
      return { processed: true };
    }
    case 'messages.update': {
      for (const d of dataList) {
        const id = d?.keyId ?? d?.key?.id ?? d?.messageId;
        const status = STATUS_MAP[String(d?.status ?? '').toUpperCase()];
        if (id && status) await updateMessageStatus(id, status);
      }
      return { processed: true };
    }
    case 'connection.update': {
      const state = String(body.data?.state ?? '');
      const status = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected';
      const phone = phoneFromJid(body.data?.wuid ?? body.data?.ownerJid ?? body.sender ?? null);
      const updates: Record<string, unknown> = {};
      if (channel.transport === 'evolution') updates.status = status;
      if (phone && state === 'open') updates.phone = phone;
      await channelRepository.update(accountId, channel.id, updates);
      await log({
        accountId,
        level: status === 'disconnected' ? 'warn' : 'info',
        category: 'whatsapp',
        action: status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'disconnected',
        message: `${channel.label}: ${status === 'connected' ? 'conectado' : status === 'connecting' ? 'conectando' : 'desconectado'}`,
        meta: { channelId: channel.id, instance, phone },
      });
      await emitChannels(accountId);
      return { processed: true };
    }
    case 'qrcode.updated': {
      const qrcode = body.data?.qrcode?.base64 ?? body.data?.base64 ?? null;
      if (qrcode) realtime.emit(accountId, 'channel.qrcode', { channelId: channel.id, qrcode });
      return { processed: true };
    }
    default:
      return { processed: false, reason: `evento ignorado: ${event}` };
  }
}

/**
 * Webhook genérico (/api/webhook/whatsapp) — formato simplificado para outros provedores:
 * { channelId|instance, type: 'message'|'status'|'connection', id, phone, name, body, fromMe, status, timestamp }
 */
export async function handleGenericEvent(accountId: number, body: any) {
  const id = String(body?.id ?? '');
  const eventKey = sha256(`${accountId}:${body?.type}:${id}:${body?.status ?? ''}:${id ? '' : JSON.stringify(body)}`);
  if (!(await claimEvent('whatsapp', eventKey))) return { processed: false, reason: 'duplicado' };
  const channel = body.instance
    ? await channelRepository.findByInstance(String(body.instance))
    : body.channelId
      ? await channelRepository.findById(accountId, Number(body.channelId))
      : null;
  if (!channel || channel.accountId !== accountId) return { processed: false, reason: 'canal não encontrado' };
  if (body.type === 'message') {
    await handleIncoming({
      accountId,
      channelId: channel.id,
      phone: String(body.phone ?? ''),
      name: body.name ?? null,
      body: body.body ?? null,
      externalId: id || null,
      fromMe: !!body.fromMe,
      timestamp: body.timestamp ? new Date(body.timestamp) : undefined,
      transport: 'webhook',
    });
  } else if (body.type === 'status' && id && ['sent', 'delivered', 'read', 'failed'].includes(body.status)) {
    await updateMessageStatus(id, body.status);
  } else if (body.type === 'connection' && ['connected', 'connecting', 'disconnected'].includes(body.status)) {
    await channelRepository.update(accountId, channel.id, { status: body.status });
    await emitChannels(accountId);
  } else {
    return { processed: false, reason: 'tipo não suportado' };
  }
  return { processed: true };
}
