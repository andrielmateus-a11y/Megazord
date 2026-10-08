// Indicadores do Dashboard e do Monitor de envio.
import { db } from '../../db/dbClient.js';
import { startOfLocalDay } from '../lib/time.js';
import { queueStats } from '../queue/queueService.js';
import { bridgeSummary, listChannels } from './channelService.js';
import { rotationOverview } from './rotationService.js';

export async function dashboard(accountId: number) {
  const today = startOfLocalDay();
  const [counts] = await db().query(
    `SELECT
       (SELECT count(*)::int FROM leads l JOIN contacts ct ON ct.id = l.contact_id
          WHERE l.account_id = $1 AND l.contact_count = 0 AND ct.phone IS NOT NULL AND l.do_not_contact = false
          AND l.status NOT IN ('nao_contatar','sem_interesse','convertido')) AS leads_available,
       (SELECT count(*)::int FROM leads WHERE account_id = $1 AND contact_count > 0) AS companies_worked,
       (SELECT count(*)::int FROM companies WHERE account_id = $1) AS companies_total,
       (SELECT count(*)::int FROM messages WHERE account_id = $1 AND direction = 'out' AND status <> 'failed') AS sent_total,
       (SELECT count(*)::int FROM messages WHERE account_id = $1 AND direction = 'out' AND status <> 'failed' AND created_at >= $2) AS sent_today,
       (SELECT count(*)::int FROM messages WHERE account_id = $1 AND direction = 'in') AS received_total,
       (SELECT count(*)::int FROM messages WHERE account_id = $1 AND direction = 'in' AND created_at >= $2) AS received_today,
       (SELECT count(*)::int FROM chats WHERE account_id = $1 AND status = 'open') AS open_chats,
       (SELECT count(*)::int FROM chats WHERE account_id = $1 AND unread_count > 0) AS unread_chats,
       (SELECT count(*)::int FROM message_queue WHERE account_id = $1 AND status IN ('pending','processing')) AS queue,
       (SELECT count(*)::int FROM campaigns WHERE account_id = $1 AND status IN ('running','scheduled')) AS active_campaigns`,
    [accountId, today],
  );
  const statusRows = await db().query(`SELECT status, count(*)::int AS n FROM leads WHERE account_id = $1 GROUP BY status`, [accountId]);
  const channels = await listChannels(accountId);
  return {
    leadsAvailable: counts.leads_available,
    companiesWorked: counts.companies_worked,
    companiesTotal: counts.companies_total,
    messagesSent: counts.sent_total,
    messagesSentToday: counts.sent_today,
    messagesReceived: counts.received_total,
    messagesReceivedToday: counts.received_today,
    openChats: counts.open_chats,
    unreadChats: counts.unread_chats,
    queue: counts.queue,
    activeCampaigns: counts.active_campaigns,
    channelsConnected: channels.filter((c) => c.status === 'connected' && !c.paused).length,
    channelsTotal: channels.length,
    leadsByStatus: Object.fromEntries(statusRows.map((r) => [r.status, r.n])),
    bridge: bridgeSummary(accountId),
  };
}

export async function monitor(accountId: number) {
  const channels = await listChannels(accountId);
  return {
    stats: await queueStats(accountId),
    rotation: await rotationOverview(accountId),
    channels: channels.map((c) => ({
      id: c.id,
      label: c.label,
      status: c.paused ? 'paused' : c.status,
      sentToday: c.sentToday,
      sentCount: c.sentCount,
      dailyLimit: c.dailyLimit,
      queueCount: c.queueCount,
      availability: c.availability,
      lastSentAt: c.lastSentAt,
      lastError: c.lastError,
      container: c.container?.name ?? null,
      transport: c.transport,
    })),
  };
}
