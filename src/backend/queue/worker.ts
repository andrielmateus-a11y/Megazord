// Processador da fila. Fluxo de cada item:
//   Lead → Fila → regras do contato → Próximo WhatsApp (rodízio) → Container/Transporte → Envio
//   → Registro (mensagem, conversa, lead, histórico) → Avança ponteiro → Próximo lead
import { db } from '../../db/dbClient.js';
import { renderTemplate } from '../../shared/text.js';
import { config } from '../config.js';
import { isWithinWindow, startOfLocalDay } from '../lib/time.js';
import { bridgeHub } from '../integrations/firefox/bridgeHub.js';
import { TransportError } from '../integrations/whatsapp/WhatsAppTransport.js';
import { channelRepository, type ChannelRow } from '../repositories/channelRepository.js';
import { chatRepository } from '../repositories/chatRepository.js';
import { historyRepository, leadRepository } from '../repositories/leadRepository.js';
import { channelAvailability, emitChannels } from '../services/channelService.js';
import { checkEligibility } from '../services/eligibilityService.js';
import { log } from '../services/logService.js';
import { realtime } from '../services/realtime.js';
import { advancePointer, chooseChannel } from '../services/rotationService.js';
import { getTransport } from '../services/transportRegistry.js';
import { emitQueue, enqueue } from './queueService.js';

export interface ProcessOutcome {
  status: 'sent' | 'skipped' | 'rescheduled' | 'error' | 'not_claimed';
  reason?: string | null;
  messageId?: number;
  channelLabel?: string;
  channelId?: number;
}

// Envios são serializados: um por vez, garantindo a ordem do rodízio e respeitando cooldowns.
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function loadContext(item: any) {
  const lead = item.lead_id ? await db().maybeOne(
    `SELECT l.*, c.cnpj, c.razao_social, c.nome_fantasia, c.cidade, ct.name AS contact_name
     FROM leads l JOIN companies c ON c.id = l.company_id LEFT JOIN contacts ct ON ct.id = COALESCE($2, l.contact_id) WHERE l.id = $1`,
    [item.lead_id, item.contact_id],
  ) : null;
  const template = item.template_id ? await db().maybeOne('SELECT body FROM message_templates WHERE id = $1', [item.template_id]) : null;
  const campaign = item.campaign_id ? await db().maybeOne('SELECT * FROM campaigns WHERE id = $1', [item.campaign_id]) : null;
  return { lead, template, campaign };
}

async function finish(itemId: number, data: { status: string; error?: string | null; skipReason?: string | null; scheduledAt?: Date; channelId?: number | null; messageId?: number | null; undoAttempt?: boolean }) {
  await db().query(
    `UPDATE message_queue SET status = $2, last_error = COALESCE($3, last_error), skip_reason = $4,
       scheduled_at = COALESCE($5, scheduled_at), channel_id = COALESCE($6, channel_id), message_id = COALESCE($7, message_id),
       attempts = CASE WHEN $8 THEN GREATEST(attempts - 1, 0) ELSE attempts END,
       processed_at = CASE WHEN $2 IN ('sent','error','cancelled') THEN now() ELSE processed_at END
     WHERE id = $1`,
    [itemId, data.status, data.error ?? null, data.skipReason ?? null, data.scheduledAt ?? null, data.channelId ?? null, data.messageId ?? null, !!data.undoAttempt],
  );
}

async function setCampaignContact(item: any, status: string, reason: string | null) {
  if (!item.campaign_id || !item.lead_id) return;
  await db().query(`UPDATE campaign_contacts SET status = $3, reason = $4, step = $5, updated_at = now() WHERE campaign_id = $1 AND lead_id = $2`, [
    item.campaign_id,
    item.lead_id,
    status,
    reason,
    item.step,
  ]);
  realtime.emit(item.account_id, 'campaign.updated', { campaignId: item.campaign_id });
}

/** Processa um item da fila. Também usado para envios imediatos (manual/Inbox). */
export function processItem(itemId: number): Promise<ProcessOutcome> {
  return serialized(() => processItemUnsafe(itemId));
}

async function processItemUnsafe(itemId: number): Promise<ProcessOutcome> {
  const item = await db().maybeOne(
    `UPDATE message_queue SET status = 'processing', attempts = attempts + 1 WHERE id = $1 AND status = 'pending' RETURNING *`,
    [itemId],
  );
  if (!item) return { status: 'not_claimed' };
  const accountId: number = item.account_id;
  await emitQueue(accountId);
  const { lead, template, campaign } = await loadContext(item);

  // 1) Regras do contato (duplicidade, opt-out, bloqueios).
  const eligibility = await checkEligibility({
    accountId,
    phone: item.phone,
    leadId: item.lead_id,
    cnpj: lead?.cnpj,
    kind: item.kind,
    queueItemId: item.id,
  });
  if (!eligibility.ok) {
    await finish(item.id, { status: 'cancelled', skipReason: eligibility.reason });
    await setCampaignContact(item, 'skipped', eligibility.reason);
    if (eligibility.cancelSequence && item.lead_id) {
      await db().query(
        `UPDATE message_queue SET status = 'cancelled', skip_reason = 'Sequência cancelada: ' || $2
         WHERE lead_id = $1 AND kind = 'followup' AND status IN ('pending','paused')`,
        [item.lead_id, eligibility.reason],
      );
    }
    await log({ accountId, userId: item.created_by, level: 'warn', category: 'queue', action: 'skipped', message: `Não enviado: ${eligibility.reason}`, meta: { queueItemId: item.id, phone: item.phone, leadId: item.lead_id } });
    await emitQueue(accountId);
    return { status: 'skipped', reason: eligibility.reason };
  }

  // 2) Escolha do canal no momento do processamento.
  let channel: ChannelRow | null = null;
  const immediate = item.kind === 'manual';
  if (item.channel_mode === 'manual' && item.channel_id) {
    channel = await channelRepository.findById(accountId, item.channel_id);
    const avail = channel ? channelAvailability(channel, { bridgeConnected: bridgeHub.isConnected(accountId), forAutomatic: false }) : { available: false, reason: 'Canal removido' };
    if (!avail.available) {
      if (immediate) {
        await finish(item.id, { status: 'error', error: `${channel?.label ?? 'Canal'}: ${avail.reason}` });
        await emitQueue(accountId);
        return { status: 'error', reason: `${channel?.label ?? 'Canal'} indisponível: ${avail.reason}` };
      }
      await finish(item.id, { status: 'pending', error: `${channel?.label ?? 'Canal'} indisponível: ${avail.reason}`, scheduledAt: new Date(Date.now() + 60000), undoAttempt: true });
      await emitQueue(accountId);
      return { status: 'rescheduled', reason: avail.reason };
    }
  } else {
    const allowed = (campaign?.channel_ids as number[] | undefined) ?? null;
    const choice = await chooseChannel(accountId, allowed);
    channel = choice.channel;
    if (!channel) {
      const reason = 'Nenhum WhatsApp disponível no momento';
      if (immediate) {
        await finish(item.id, { status: 'error', error: reason });
        await emitQueue(accountId);
        return { status: 'error', reason };
      }
      await finish(item.id, { status: 'pending', error: reason, scheduledAt: new Date(Date.now() + 30000), undoAttempt: true });
      await emitQueue(accountId);
      return { status: 'rescheduled', reason };
    }
  }

  if (!channel) return { status: 'error', reason: 'Canal indisponível' };
  const ch: ChannelRow = channel;

  // 3) Mensagem personalizada.
  const vars = {
    socio: lead?.contact_name ?? null,
    empresa: lead ? lead.nome_fantasia || lead.razao_social : null,
    telefone: item.phone,
    cidade: lead?.cidade ?? null,
    cnpj: lead?.cnpj ?? null,
  };
  const text = renderTemplate(item.body || template?.body || '', vars);
  if (!text) {
    await finish(item.id, { status: 'error', error: 'Mensagem vazia' });
    await emitQueue(accountId);
    return { status: 'error', reason: 'Mensagem vazia' };
  }

  // 4) Envio pelo transporte do canal (um único transporte).
  const transport = getTransport(ch.transport);
  const started = Date.now();
  try {
    const result = await transport.send({ accountId, channel: ch, phone: item.phone, text });
    const messageId = await db().tx(async (q) => {
      const chatId = await chatRepository.upsert(q, accountId, ch.id, item.phone, {
        leadId: item.lead_id,
        contactId: item.contact_id,
        name: lead?.contact_name ?? null,
      });
      const id = await chatRepository.insertMessage(q, {
        accountId,
        chatId,
        direction: 'out',
        body: text,
        status: 'sent',
        companyId: item.company_id ?? lead?.company_id ?? null,
        contactId: item.contact_id,
        leadId: item.lead_id,
        channelId: ch.id,
        campaignId: item.campaign_id,
        userId: item.created_by,
        queueItemId: item.id,
        transport: transport.name,
        containerName: result.containerName,
        externalId: result.externalId,
      });
      await chatRepository.touch(q, chatId, text, false);
      if (item.lead_id) {
        await leadRepository.registerOutbound(q, item.lead_id, ch.id, item.created_by);
        await historyRepository.add(q, {
          accountId,
          leadId: item.lead_id,
          companyId: item.company_id ?? lead?.company_id ?? null,
          userId: item.created_by,
          channelId: ch.id,
          type: item.kind === 'followup' ? 'followup_sent' : item.kind === 'manual' ? 'message_sent' : 'activation_sent',
          description: `${item.kind === 'followup' ? `Follow-up (etapa ${item.step})` : item.kind === 'manual' ? 'Mensagem' : 'Mensagem de ativação'} enviada pelo ${ch.label}${result.containerName ? ` (${result.containerName})` : ''}`,
        });
      }
      await channelRepository.registerSend(q, ch.id);
      if (item.channel_mode === 'auto') await advancePointer(q, accountId, ch);
      if (item.campaign_id) await q.query('UPDATE campaigns SET last_sent_at = now() WHERE id = $1', [item.campaign_id]);
      return id;
    });
    await finish(item.id, { status: 'sent', channelId: ch.id, messageId, skipReason: null });
    await setCampaignContact(item, 'sent', null);
    await scheduleCadence(item, campaign, ch.id);
    await log({
      accountId,
      userId: item.created_by,
      category: 'whatsapp',
      action: 'message_sent',
      message: `Enviado para ${item.phone} pelo ${ch.label}${result.containerName ? ` → ${result.containerName}` : ''}`,
      meta: {
        queueItemId: item.id,
        channelId: ch.id,
        channelNumber: ch.phone,
        transport: transport.name,
        container: result.containerName,
        bridgeResponse: result.bridgeResponse,
        ms: Date.now() - started,
      },
    });
    const message = await chatRepository.messageById(messageId);
    realtime.emit(accountId, 'message.new', { message });
    realtime.emit(accountId, 'chat.updated', { chatId: message?.chatId });
    if (item.lead_id) realtime.emit(accountId, 'lead.updated', { leadId: item.lead_id });
    await emitQueue(accountId);
    await emitChannels(accountId);
    return { status: 'sent', messageId, channelLabel: ch.label, channelId: ch.id };
  } catch (err) {
    const te = err instanceof TransportError ? err : new TransportError('Falha inesperada no envio.', true, true, (err as Error).message);
    if (te.channelProblem) await channelRepository.registerError(ch.id, te.userMessage);
    const canRetry = !immediate && te.retryable && item.attempts < item.max_attempts;
    // Em modo automático, um problema do canal faz o item tentar logo outro número.
    const delay = item.channel_mode === 'auto' && te.channelProblem ? 5000 : 60000 * item.attempts;
    await finish(item.id, {
      status: canRetry ? 'pending' : 'error',
      error: te.userMessage,
      scheduledAt: canRetry ? new Date(Date.now() + delay) : undefined,
      channelId: ch.id,
    });
    if (!canRetry) await setCampaignContact(item, 'error', te.userMessage);
    await log({
      accountId,
      userId: item.created_by,
      level: 'error',
      category: 'whatsapp',
      action: 'send_failed',
      message: `Falha ao enviar pelo ${ch.label}: ${te.userMessage}`,
      meta: { queueItemId: item.id, channelId: ch.id, transport: transport.name, container: ch.container?.name, technical: te.message, willRetry: canRetry },
    });
    await emitQueue(accountId);
    await emitChannels(accountId);
    return { status: canRetry ? 'rescheduled' : 'error', reason: te.userMessage, channelLabel: ch.label, channelId: ch.id };
  }
}

/** Cadência: agenda os próximos passos (ex.: Dia 3 follow-up, Dia 7 último contato) no mesmo canal. */
async function scheduleCadence(item: any, campaign: any, channelId: number) {
  if (!campaign || !item.lead_id) return;
  const steps = (campaign.cadence ?? []) as { step: number; dayOffset: number; templateId: number }[];
  const next = steps.filter((s) => s.step > item.step).sort((a, b) => a.step - b.step)[0];
  if (!next) return;
  const prevOffset = steps.find((s) => s.step === item.step)?.dayOffset ?? 0;
  const days = Math.max(next.dayOffset - prevOffset, 0);
  await enqueue(db(), {
    accountId: item.account_id,
    userId: item.created_by,
    phone: item.phone,
    leadId: item.lead_id,
    companyId: item.company_id,
    contactId: item.contact_id,
    templateId: next.templateId,
    campaignId: item.campaign_id,
    channelId,
    kind: 'followup',
    step: next.step,
    scheduledAt: new Date(Date.now() + days * 86400000),
  });
}

async function campaignAllowsNow(campaign: any): Promise<boolean> {
  if (campaign.status !== 'running') return false;
  if (!isWithinWindow(campaign.window_start, campaign.window_end, campaign.weekdays ?? [])) return false;
  if (campaign.last_sent_at && Date.now() - new Date(campaign.last_sent_at).getTime() < campaign.interval_seconds * 1000) return false;
  const sentToday = await db().one(
    `SELECT count(*)::int AS n FROM messages WHERE campaign_id = $1 AND direction = 'out' AND status <> 'failed' AND created_at >= $2`,
    [campaign.id, startOfLocalDay()],
  );
  return sentToday.n < campaign.daily_limit;
}

let running = false;

/** Um ciclo do worker: ativa campanhas agendadas, escolhe os itens vencidos e processa respeitando as regras. */
export async function tick(): Promise<number> {
  if (running) return 0;
  running = true;
  let processed = 0;
  try {
    await db().query(`UPDATE campaigns SET status = 'running', updated_at = now() WHERE status = 'scheduled' AND (start_at IS NULL OR start_at <= now())`);
    const due = await db().query(
      `SELECT q.id, q.campaign_id FROM message_queue q LEFT JOIN campaigns c ON c.id = q.campaign_id
       WHERE q.status = 'pending' AND q.scheduled_at <= now() AND (q.campaign_id IS NULL OR c.status = 'running')
       ORDER BY q.priority DESC, q.scheduled_at, q.id LIMIT 50`,
    );
    const campaignsDone = new Set<number>();
    for (const row of due) {
      if (row.campaign_id) {
        if (campaignsDone.has(row.campaign_id)) continue;
        campaignsDone.add(row.campaign_id); // no máximo 1 envio por campanha por ciclo (intervalo controlado)
        const campaign = await db().maybeOne('SELECT * FROM campaigns WHERE id = $1', [row.campaign_id]);
        if (!campaign || !(await campaignAllowsNow(campaign))) continue;
      }
      const outcome = await processItem(row.id);
      if (outcome.status !== 'not_claimed') processed++;
    }
    await completeCampaigns();
  } catch (err) {
    console.error('[queue] erro no ciclo:', (err as Error).message);
  } finally {
    running = false;
  }
  return processed;
}

async function completeCampaigns() {
  const done = await db().query(
    `UPDATE campaigns c SET status = 'completed', updated_at = now()
     WHERE c.status = 'running' AND NOT EXISTS (
       SELECT 1 FROM message_queue q WHERE q.campaign_id = c.id AND q.status IN ('pending','processing','paused'))
     RETURNING id, account_id, name`,
  );
  for (const c of done) {
    await log({ accountId: c.account_id, category: 'campaign', action: 'completed', message: `Campanha "${c.name}" concluída` });
    realtime.emit(c.account_id, 'campaign.updated', { campaignId: c.id });
  }
}

let timer: NodeJS.Timeout | null = null;

export async function startWorker() {
  // Itens que ficaram "processando" após uma queda voltam para a fila.
  await db().query(`UPDATE message_queue SET status = 'pending', attempts = GREATEST(attempts - 1, 0) WHERE status = 'processing'`);
  if (!config.queue.enabled) {
    console.log('[queue] worker desativado (QUEUE_WORKER_ENABLED=false)');
    return;
  }
  timer = setInterval(() => void tick(), config.queue.tickMs);
  console.log(`[queue] worker iniciado (ciclo de ${config.queue.tickMs}ms)`);
}

export function stopWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
