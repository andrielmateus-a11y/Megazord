// Canais WhatsApp + Firefox Container associado.
import { camel, db, type Queryable, type Row } from '../../db/dbClient.js';
import { channelLabel } from '../../shared/constants.js';
import { startOfLocalDay } from '../lib/time.js';

export interface ChannelRow {
  id: number;
  accountId: number;
  orderIndex: number;
  name: string;
  phone: string | null;
  transport: 'firefox' | 'evolution';
  evolutionInstance: string | null;
  status: 'connected' | 'connecting' | 'disconnected' | 'not_configured';
  paused: boolean;
  queueEnabled: boolean;
  dailyLimit: number;
  cooldownSeconds: number;
  cooldownUntil: string | null;
  lastSentAt: string | null;
  sentCount: number;
  receivedCount: number;
  consecutiveErrors: number;
  lastError: string | null;
  sentToday: number;
  queueCount: number;
  label: string;
  container: {
    id: number;
    channelId: number;
    name: string;
    cookieStoreId: string | null;
    color: string;
    icon: string;
    status: 'ok' | 'not_found' | 'unknown';
    waStatus: 'ready' | 'not_open' | 'logged_out' | 'loading' | 'unknown';
    lastSeenAt: string | null;
  } | null;
}

const SELECT = `
  SELECT ch.*,
    fc.id AS fc_id, fc.name AS fc_name, fc.cookie_store_id AS fc_cookie_store_id, fc.color AS fc_color, fc.icon AS fc_icon,
    fc.status AS fc_status, fc.wa_status AS fc_wa_status, fc.last_seen_at AS fc_last_seen_at,
    (SELECT count(*)::int FROM messages m WHERE m.channel_id = ch.id AND m.direction = 'out'
       AND m.status <> 'failed' AND m.created_at >= $2) AS sent_today,
    (SELECT count(*)::int FROM message_queue q WHERE q.channel_id = ch.id AND q.status IN ('pending','processing')) AS queue_count
  FROM whatsapp_channels ch
  LEFT JOIN firefox_containers fc ON fc.channel_id = ch.id`;

function map(row: Row): ChannelRow {
  const base = camel<any>(Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('fc_'))));
  return {
    ...base,
    label: channelLabel(base.orderIndex),
    container: row.fc_id
      ? {
          id: row.fc_id,
          channelId: base.id,
          name: row.fc_name,
          cookieStoreId: row.fc_cookie_store_id,
          color: row.fc_color,
          icon: row.fc_icon,
          status: row.fc_status,
          waStatus: row.fc_wa_status,
          lastSeenAt: row.fc_last_seen_at instanceof Date ? row.fc_last_seen_at.toISOString() : row.fc_last_seen_at,
        }
      : null,
  };
}

export const channelRepository = {
  async list(accountId: number, q: Queryable = db()): Promise<ChannelRow[]> {
    const rows = await q.query(`${SELECT} WHERE ch.account_id = $1 ORDER BY ch.order_index`, [accountId, startOfLocalDay()]);
    return rows.map(map);
  },
  async findById(accountId: number, id: number, q: Queryable = db()): Promise<ChannelRow | null> {
    const [row] = await q.query(`${SELECT} WHERE ch.account_id = $1 AND ch.id = $3`, [accountId, startOfLocalDay(), id]);
    return row ? map(row) : null;
  },
  async findByInstance(instance: string): Promise<ChannelRow | null> {
    const [row] = await db().query(`${SELECT} WHERE ch.evolution_instance = $1`, [instance, startOfLocalDay()]);
    return row ? map(row) : null;
  },
  async update(
    accountId: number,
    id: number,
    data: Partial<{
      name: string;
      phone: string | null;
      transport: string;
      evolutionInstance: string | null;
      status: string;
      paused: boolean;
      queueEnabled: boolean;
      dailyLimit: number;
      cooldownSeconds: number;
      lastError: string | null;
      consecutiveErrors: number;
    }>,
  ) {
    const map: Record<string, string> = {
      name: 'name',
      phone: 'phone',
      transport: 'transport',
      evolutionInstance: 'evolution_instance',
      status: 'status',
      paused: 'paused',
      queueEnabled: 'queue_enabled',
      dailyLimit: 'daily_limit',
      cooldownSeconds: 'cooldown_seconds',
      lastError: 'last_error',
      consecutiveErrors: 'consecutive_errors',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined || !map[k]) continue;
      params.push(v);
      sets.push(`${map[k]} = $${params.length}`);
    }
    if (!sets.length) return;
    params.push(accountId, id);
    await db().query(
      `UPDATE whatsapp_channels SET ${sets.join(', ')} WHERE account_id = $${params.length - 1} AND id = $${params.length}`,
      params,
    );
  },
  async registerSend(q: Queryable, channelId: number) {
    await q.query(
      `UPDATE whatsapp_channels SET sent_count = sent_count + 1, last_sent_at = now(), consecutive_errors = 0, last_error = NULL,
         cooldown_until = now() + make_interval(secs => cooldown_seconds) WHERE id = $1`,
      [channelId],
    );
  },
  async registerError(channelId: number, error: string) {
    await db().query(
      // Erro do canal: sai do rodízio por alguns minutos (cooldown) para o próximo item usar outro número.
      `UPDATE whatsapp_channels SET consecutive_errors = consecutive_errors + 1, last_error = $2,
         cooldown_until = GREATEST(COALESCE(cooldown_until, now()), now() + interval '2 minutes') WHERE id = $1`,
      [channelId, error],
    );
  },
};
