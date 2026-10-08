// Conversas e mensagens do Inbox unificado.
import { camel, db, type Queryable, type Row } from '../../db/dbClient.js';
import { channelLabel } from '../../shared/constants.js';
import type { Chat, Message } from '../../shared/types.js';

const CHAT_SELECT = `
  SELECT ch.*, w.order_index, co.razao_social, co.nome_fantasia
  FROM chats ch
  JOIN whatsapp_channels w ON w.id = ch.channel_id
  LEFT JOIN leads l ON l.id = ch.lead_id
  LEFT JOIN companies co ON co.id = l.company_id`;

function mapChat(row: Row): Chat {
  const c = camel<any>(row);
  return {
    id: c.id,
    channelId: c.channelId,
    channelLabel: channelLabel(c.orderIndex),
    leadId: c.leadId,
    contactId: c.contactId,
    remotePhone: c.remotePhone,
    remoteName: c.remoteName,
    companyName: c.nomeFantasia || c.razaoSocial || null,
    lastMessageAt: c.lastMessageAt,
    lastMessagePreview: c.lastMessagePreview,
    unreadCount: c.unreadCount,
    status: c.status,
  };
}

function mapMessage(row: Row): Message {
  const m = camel<any>(row);
  return {
    id: m.id,
    chatId: m.chatId,
    channelId: m.channelId,
    direction: m.direction,
    body: m.body,
    media: m.media,
    status: m.status,
    transport: m.transport,
    containerName: m.containerName,
    error: m.error,
    userName: m.userName ?? null,
    campaignId: m.campaignId,
    createdAt: m.createdAt,
  };
}

export const chatRepository = {
  async upsert(
    q: Queryable,
    accountId: number,
    channelId: number,
    phone: string,
    data: { leadId?: number | null; contactId?: number | null; name?: string | null },
  ): Promise<number> {
    const [row] = await q.query(
      `INSERT INTO chats (account_id, channel_id, remote_phone, lead_id, contact_id, remote_name) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (account_id, channel_id, remote_phone) DO UPDATE SET
         lead_id = COALESCE(chats.lead_id, EXCLUDED.lead_id),
         contact_id = COALESCE(chats.contact_id, EXCLUDED.contact_id),
         remote_name = COALESCE(chats.remote_name, EXCLUDED.remote_name),
         status = 'open'
       RETURNING id`,
      [accountId, channelId, phone, data.leadId ?? null, data.contactId ?? null, data.name ?? null],
    );
    return row.id;
  },
  async touch(q: Queryable, chatId: number, preview: string, incoming: boolean) {
    await q.query(
      `UPDATE chats SET last_message_at = now(), last_message_preview = $2,
         unread_count = CASE WHEN $3 THEN unread_count + 1 ELSE unread_count END WHERE id = $1`,
      [chatId, preview.slice(0, 160), incoming],
    );
  },
  async findById(accountId: number, id: number): Promise<Chat | null> {
    const row = await db().maybeOne(`${CHAT_SELECT} WHERE ch.account_id = $1 AND ch.id = $2`, [accountId, id]);
    return row ? mapChat(row) : null;
  },
  async list(accountId: number, f: { channelId?: number; search?: string; unreadOnly?: boolean; limit?: number }) {
    const where = ['ch.account_id = $1'];
    const params: unknown[] = [accountId];
    if (f.channelId) {
      params.push(f.channelId);
      where.push(`ch.channel_id = $${params.length}`);
    }
    if (f.unreadOnly) where.push('ch.unread_count > 0');
    if (f.search) {
      params.push(`%${f.search.toLowerCase()}%`);
      where.push(`(lower(coalesce(ch.remote_name,'')) LIKE $${params.length} OR ch.remote_phone LIKE $${params.length}
        OR lower(coalesce(co.razao_social,'')) LIKE $${params.length} OR lower(coalesce(co.nome_fantasia,'')) LIKE $${params.length})`);
    }
    params.push(Math.min(f.limit ?? 200, 500));
    const rows = await db().query(
      `${CHAT_SELECT} WHERE ${where.join(' AND ')} ORDER BY ch.last_message_at DESC NULLS LAST, ch.id DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map(mapChat);
  },
  async markRead(accountId: number, id: number) {
    await db().query('UPDATE chats SET unread_count = 0 WHERE account_id = $1 AND id = $2', [accountId, id]);
  },
  async messages(accountId: number, chatId: number, limit = 300): Promise<Message[]> {
    const rows = await db().query(
      `SELECT * FROM (SELECT m.*, u.name AS user_name FROM messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.account_id = $1 AND m.chat_id = $2 ORDER BY m.id DESC LIMIT $3) t ORDER BY id ASC`,
      [accountId, chatId, limit],
    );
    return rows.map(mapMessage);
  },
  async messageById(id: number): Promise<Message | null> {
    const row = await db().maybeOne('SELECT m.*, u.name AS user_name FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = $1', [id]);
    return row ? mapMessage(row) : null;
  },
  async insertMessage(
    q: Queryable,
    m: {
      accountId: number;
      chatId: number;
      direction: 'in' | 'out';
      body: string | null;
      status: string;
      companyId?: number | null;
      contactId?: number | null;
      leadId?: number | null;
      channelId?: number | null;
      campaignId?: number | null;
      userId?: number | null;
      queueItemId?: number | null;
      transport?: string | null;
      containerName?: string | null;
      externalId?: string | null;
      error?: string | null;
      media?: unknown;
      createdAt?: Date;
    },
  ): Promise<number> {
    const [row] = await q.query(
      `INSERT INTO messages (account_id, chat_id, direction, body, status, company_id, contact_id, lead_id, channel_id, campaign_id,
         user_id, queue_item_id, transport, container_name, external_id, error, media, created_at, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, COALESCE($18, now()),
         CASE WHEN $3 = 'out' AND $5 <> 'failed' THEN now() ELSE NULL END)
       RETURNING id`,
      [
        m.accountId, m.chatId, m.direction, m.body, m.status, m.companyId ?? null, m.contactId ?? null, m.leadId ?? null,
        m.channelId ?? null, m.campaignId ?? null, m.userId ?? null, m.queueItemId ?? null, m.transport ?? null,
        m.containerName ?? null, m.externalId ?? null, m.error ?? null, m.media ? JSON.stringify(m.media) : null, m.createdAt ?? null,
      ],
    );
    return row.id;
  },
};
export { mapMessage, mapChat };
