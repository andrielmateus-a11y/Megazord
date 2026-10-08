// Gestão dos canais WhatsApp (WA 01..WA 08), Firefox Containers, Evolution e disponibilidade para o rodízio.
import { db } from '../../db/dbClient.js';
import { MAX_CHANNELS, channelLabel, containerLabel } from '../../shared/constants.js';
import type { Channel } from '../../shared/types.js';
import { conflict, notFound } from '../lib/errors.js';
import { bridgeHub, type BridgeState } from '../integrations/firefox/bridgeHub.js';
import { EVOLUTION_EVENTS } from '../integrations/evolution/EvolutionClient.js';
import { insertChannel } from './accountService.js';
import { channelRepository, type ChannelRow } from '../repositories/channelRepository.js';
import { evolutionClientFor, evolutionWebhookUrl } from './evolutionService.js';
import { log } from './logService.js';
import { realtime } from './realtime.js';

const MAX_CONSECUTIVE_ERRORS = 3;

/** Regra de disponibilidade do CANAL (seção 54). */
export function channelAvailability(
  ch: ChannelRow,
  ctx: { bridgeConnected: boolean; forAutomatic: boolean; now?: number },
): { available: boolean; reason: string | null } {
  const now = ctx.now ?? Date.now();
  if (ch.paused) return { available: false, reason: 'Pausado' };
  if (ctx.forAutomatic && !ch.queueEnabled) return { available: false, reason: 'Fila desativada' };
  if (ch.transport === 'firefox') {
    if (!ctx.bridgeConnected) return { available: false, reason: 'Firefox Bridge desconectado' };
    if (!ch.container?.cookieStoreId || ch.container.status !== 'ok') return { available: false, reason: 'Container não encontrado' };
    if (ch.container.waStatus === 'logged_out') return { available: false, reason: 'Sessão do WhatsApp inválida' };
    if (ch.container.waStatus !== 'ready') return { available: false, reason: 'WhatsApp Web não aberto' };
  } else {
    if (!ch.evolutionInstance) return { available: false, reason: 'Sem instância Evolution' };
    if (ch.status !== 'connected') return { available: false, reason: 'Desconectado' };
  }
  if (ch.sentToday >= ch.dailyLimit) return { available: false, reason: 'Limite diário atingido' };
  if (ch.cooldownUntil && Date.parse(ch.cooldownUntil) > now) return { available: false, reason: 'Em cooldown' };
  if (ch.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) return { available: false, reason: 'Erros consecutivos — verifique o canal' };
  return { available: true, reason: null };
}

export function toApiChannel(ch: ChannelRow, bridgeConnected: boolean): Channel {
  return {
    id: ch.id,
    orderIndex: ch.orderIndex,
    label: ch.label,
    name: ch.name,
    phone: ch.phone,
    transport: ch.transport,
    evolutionInstance: ch.evolutionInstance,
    status: ch.status,
    paused: ch.paused,
    queueEnabled: ch.queueEnabled,
    dailyLimit: ch.dailyLimit,
    cooldownSeconds: ch.cooldownSeconds,
    cooldownUntil: ch.cooldownUntil,
    lastSentAt: ch.lastSentAt,
    sentCount: ch.sentCount,
    sentToday: ch.sentToday,
    receivedCount: ch.receivedCount,
    queueCount: ch.queueCount,
    lastError: ch.lastError,
    container: ch.container,
    availability: channelAvailability(ch, { bridgeConnected, forAutomatic: true }),
  };
}

export async function listChannels(accountId: number): Promise<Channel[]> {
  const rows = await channelRepository.list(accountId);
  const connected = bridgeHub.isConnected(accountId);
  return rows.map((r) => toApiChannel(r, connected));
}

export async function emitChannels(accountId: number) {
  realtime.emit(accountId, 'channels.updated', { channels: await listChannels(accountId) });
}

async function getChannel(accountId: number, id: number): Promise<ChannelRow> {
  const ch = await channelRepository.findById(accountId, id);
  if (!ch) throw notFound('Canal não encontrado.');
  return ch;
}

/** Botão "+": adiciona o próximo número livre (WA 05, WA 06...) até WA 08, com seu Container. */
export async function addChannel(accountId: number, userId: number) {
  const channel = await db().tx(async (q) => {
    const rows = await q.query('SELECT order_index FROM whatsapp_channels WHERE account_id = $1 FOR UPDATE', [accountId]);
    if (rows.length >= MAX_CHANNELS) throw conflict(`Limite operacional de ${MAX_CHANNELS} números atingido.`);
    const used = new Set(rows.map((r) => r.order_index));
    let next = 1;
    while (used.has(next)) next++;
    return insertChannel(q, accountId, next);
  });
  await log({ accountId, userId, category: 'whatsapp', action: 'channel_added', message: `${channelLabel(channel.order_index)} adicionado com ${containerLabel(channel.order_index)}`, meta: { channelId: channel.id } });
  // Pede ao bridge para criar o Container (se estiver conectado).
  ensureContainers(accountId).catch(() => undefined);
  await emitChannels(accountId);
  return getChannel(accountId, channel.id);
}

export async function removeChannel(accountId: number, userId: number, id: number) {
  const ch = await getChannel(accountId, id);
  if (ch.evolutionInstance) {
    const client = await evolutionClientFor(accountId);
    if (client.configured) await client.deleteInstance(ch.evolutionInstance).catch(() => undefined);
  }
  await db().query(`UPDATE message_queue SET channel_id = NULL, channel_mode = 'auto' WHERE channel_id = $1 AND status = 'pending'`, [id]);
  await db().query('DELETE FROM whatsapp_channels WHERE account_id = $1 AND id = $2', [accountId, id]);
  await log({ accountId, userId, category: 'whatsapp', action: 'channel_removed', message: `${ch.label} removido`, meta: { channelId: id } });
  await emitChannels(accountId);
}

export async function updateChannel(
  accountId: number,
  userId: number,
  id: number,
  data: Partial<{ name: string; phone: string | null; transport: 'firefox' | 'evolution'; evolutionInstance: string | null; dailyLimit: number; cooldownSeconds: number; containerName: string }>,
) {
  const ch = await getChannel(accountId, id);
  if (data.evolutionInstance) {
    const other = await db().maybeOne('SELECT id FROM whatsapp_channels WHERE evolution_instance = $1 AND id <> $2', [data.evolutionInstance, id]);
    if (other) throw conflict('Esta instância já está vinculada a outro canal.');
  }
  const { containerName, ...rest } = data;
  await channelRepository.update(accountId, id, rest);
  if (containerName && ch.container) {
    await db().query('UPDATE firefox_containers SET name = $2, cookie_store_id = NULL, status = $3 WHERE id = $1', [ch.container.id, containerName, 'not_found']);
    ensureContainers(accountId).catch(() => undefined);
  }
  if (data.transport && data.transport !== ch.transport) await refreshFirefoxStatuses(accountId, bridgeHub.state(accountId));
  await log({ accountId, userId, category: 'whatsapp', action: 'channel_updated', message: `${ch.label} atualizado`, meta: { channelId: id, changes: data } });
  await emitChannels(accountId);
  return getChannel(accountId, id);
}

export async function setPaused(accountId: number, userId: number, id: number, paused: boolean) {
  const ch = await getChannel(accountId, id);
  await channelRepository.update(accountId, id, { paused });
  await log({ accountId, userId, category: 'whatsapp', action: paused ? 'channel_paused' : 'channel_resumed', message: `${ch.label} ${paused ? 'pausado' : 'reativado'}`, meta: { channelId: id } });
  await emitChannels(accountId);
}

export async function setQueueEnabled(accountId: number, userId: number, id: number, enabled: boolean) {
  const ch = await getChannel(accountId, id);
  await channelRepository.update(accountId, id, { queueEnabled: enabled, consecutiveErrors: 0, lastError: null });
  await log({ accountId, userId, category: 'whatsapp', action: 'channel_queue', message: `${ch.label}: fila ${enabled ? 'ativada' : 'desativada'}`, meta: { channelId: id } });
  await emitChannels(accountId);
}

export async function resetErrors(accountId: number, id: number) {
  await channelRepository.update(accountId, id, { consecutiveErrors: 0, lastError: null });
  await db().query('UPDATE whatsapp_channels SET cooldown_until = NULL WHERE account_id = $1 AND id = $2', [accountId, id]);
  await emitChannels(accountId);
}

// ------------------------------------------------------------------ Evolution

function instanceNameFor(accountId: number, orderIndex: number) {
  return `megazord-${accountId}-wa${String(orderIndex).padStart(2, '0')}`;
}

/** Conectar: cria a instância (se preciso) e devolve o QR Code para exibir na modal. */
export async function connectEvolution(accountId: number, userId: number, id: number) {
  const ch = await getChannel(accountId, id);
  const client = await evolutionClientFor(accountId);
  let instance = ch.evolutionInstance;
  if (!instance) {
    instance = instanceNameFor(accountId, ch.orderIndex);
    const existing = (await client.fetchInstances()).find((i) => i.name === instance);
    if (!existing) await client.createInstance(instance, evolutionWebhookUrl(), EVOLUTION_EVENTS);
    await channelRepository.update(accountId, id, { evolutionInstance: instance });
  }
  await client.setWebhook(instance, evolutionWebhookUrl(), EVOLUTION_EVENTS).catch(() => undefined);
  const state = await client.connectionState(instance).catch(() => 'close');
  if (state === 'open') {
    await syncInstances(accountId, userId);
    return { connected: true, qrcode: null, pairingCode: null };
  }
  const qr = await client.connect(instance);
  await channelRepository.update(accountId, id, { status: 'connecting' });
  await log({ accountId, userId, category: 'whatsapp', action: 'evolution_connect', message: `${ch.label}: QR Code gerado`, meta: { channelId: id, instance } });
  await emitChannels(accountId);
  return { connected: false, qrcode: qr.base64, pairingCode: qr.pairingCode };
}

export async function reconnectEvolution(accountId: number, userId: number, id: number) {
  const ch = await getChannel(accountId, id);
  if (!ch.evolutionInstance) return connectEvolution(accountId, userId, id);
  const client = await evolutionClientFor(accountId);
  await client.restart(ch.evolutionInstance).catch(() => undefined);
  await log({ accountId, userId, category: 'whatsapp', action: 'evolution_reconnect', message: `${ch.label}: reconexão solicitada`, meta: { channelId: id } });
  return connectEvolution(accountId, userId, id);
}

export async function disconnectEvolution(accountId: number, userId: number, id: number) {
  const ch = await getChannel(accountId, id);
  if (ch.evolutionInstance) {
    const client = await evolutionClientFor(accountId);
    await client.logout(ch.evolutionInstance);
  }
  await channelRepository.update(accountId, id, { status: 'disconnected' });
  await log({ accountId, userId, category: 'whatsapp', action: 'evolution_disconnect', message: `${ch.label} desconectado`, meta: { channelId: id } });
  await emitChannels(accountId);
}

/** "Sincronizar Instâncias": GET /instance/fetchInstances → status e número (ownerJid) de cada canal. */
export async function syncInstances(accountId: number, userId: number | null) {
  const client = await evolutionClientFor(accountId);
  if (!client.configured) return { synced: 0, instances: [], configured: false };
  const instances = await client.fetchInstances();
  const channels = await channelRepository.list(accountId);
  let synced = 0;
  for (const ch of channels) {
    const inst = instances.find((i) => i.name === ch.evolutionInstance);
    if (!ch.evolutionInstance) continue;
    if (!inst) {
      if (ch.transport === 'evolution') await channelRepository.update(accountId, ch.id, { status: 'not_configured' });
      continue;
    }
    const status = inst.state === 'open' ? 'connected' : inst.state === 'connecting' ? 'connecting' : 'disconnected';
    await channelRepository.update(accountId, ch.id, {
      phone: inst.phone ?? ch.phone,
      ...(ch.transport === 'evolution' ? { status } : {}),
    });
    synced++;
  }
  await log({ accountId, userId, category: 'whatsapp', action: 'evolution_sync', message: `${instances.length} instância(s) encontradas; ${synced} canal(is) sincronizado(s)` });
  await emitChannels(accountId);
  return {
    synced,
    configured: true,
    instances: instances.map((i) => ({ ...i, linkedChannel: channels.find((c) => c.evolutionInstance === i.name)?.label ?? null })),
  };
}

// ------------------------------------------------------------------ Firefox Containers

/** Pede ao bridge que crie/confirme os Containers de todos os canais. */
export async function ensureContainers(accountId: number) {
  const channels = await channelRepository.list(accountId);
  const containers = channels.filter((c) => c.container).map((c) => ({ name: c.container!.name, color: c.container!.color, icon: c.container!.icon }));
  const result = await bridgeHub.command<{ containers: { name: string; cookieStoreId: string }[] }>(accountId, 'containers.ensure', { containers }, 15000);
  for (const c of result.containers ?? []) {
    await db().query(
      `UPDATE firefox_containers SET cookie_store_id = $3, status = 'ok', last_seen_at = now() WHERE account_id = $1 AND name = $2`,
      [accountId, c.name, c.cookieStoreId],
    );
  }
  await emitChannels(accountId);
  return result;
}

/** "Testar Container": abre/foca o WhatsApp Web no Container do canal (sem abrir abas duplicadas). */
export async function testContainer(accountId: number, userId: number, id: number) {
  const ch = await getChannel(accountId, id);
  if (!bridgeHub.isConnected(accountId)) {
    return { ok: false, message: 'Firefox Bridge indisponível. Abra a extensão MEGAZORD no Firefox para continuar.' };
  }
  try {
    if (!ch.container?.cookieStoreId) await ensureContainers(accountId);
    const fresh = await getChannel(accountId, id);
    if (!fresh.container?.cookieStoreId) return { ok: false, message: 'Container não encontrado no Firefox.' };
    const res = await bridgeHub.command<{ status: string; tabId: number }>(accountId, 'wa.open', { cookieStoreId: fresh.container.cookieStoreId }, 20000);
    await log({ accountId, userId, category: 'firefox', action: 'container_test', message: `${ch.label} → ${fresh.container.name}: ${res.status}`, meta: { channelId: id, container: fresh.container.name, response: res } });
    const messages: Record<string, string> = {
      ready: 'Container OK — WhatsApp Web aberto e conectado.',
      logged_out: 'Container OK, mas o WhatsApp Web pede leitura do QR Code.',
      loading: 'Container OK — WhatsApp Web carregando.',
    };
    return { ok: res.status === 'ready', message: messages[res.status] ?? `Estado: ${res.status}`, status: res.status };
  } catch (err) {
    const message = (err as any).userMessage ?? 'Falha ao testar o Container.';
    await log({ accountId, userId, level: 'warn', category: 'firefox', action: 'container_test_failed', message: `${ch.label}: ${message}`, meta: { channelId: id } });
    return { ok: false, message };
  }
}

/** Sincroniza o estado dos Containers/abas recebido no heartbeat do bridge com o banco. */
export async function refreshFirefoxStatuses(accountId: number, state: BridgeState) {
  const rows = await db().query(
    `SELECT fc.id, fc.name, fc.cookie_store_id, fc.status, fc.wa_status, ch.id AS channel_id, ch.transport, ch.status AS ch_status
     FROM firefox_containers fc JOIN whatsapp_channels ch ON ch.id = fc.channel_id WHERE fc.account_id = $1`,
    [accountId],
  );
  let changed = false;
  for (const row of rows) {
    let status = 'unknown';
    let waStatus = 'unknown';
    let cookieStoreId = row.cookie_store_id;
    if (state.connected) {
      const container =
        state.containers.find((c) => c.cookieStoreId === row.cookie_store_id) ?? state.containers.find((c) => c.name === row.name);
      status = container ? 'ok' : 'not_found';
      cookieStoreId = container?.cookieStoreId ?? null;
      const tab = container ? state.tabs.find((t) => t.cookieStoreId === container.cookieStoreId) : undefined;
      waStatus = tab ? tab.status : container ? 'not_open' : 'unknown';
    }
    if (status !== row.status || waStatus !== row.wa_status || cookieStoreId !== row.cookie_store_id) {
      changed = true;
      await db().query(
        `UPDATE firefox_containers SET status = $2, wa_status = $3, cookie_store_id = $4, last_seen_at = CASE WHEN $2 = 'ok' THEN now() ELSE last_seen_at END WHERE id = $1`,
        [row.id, status, waStatus, cookieStoreId],
      );
    }
    if (row.transport === 'firefox') {
      const chStatus = !state.connected
        ? 'disconnected'
        : status !== 'ok'
          ? 'not_configured'
          : waStatus === 'ready'
            ? 'connected'
            : waStatus === 'loading'
              ? 'connecting'
              : 'disconnected';
      if (chStatus !== row.ch_status) {
        changed = true;
        await db().query('UPDATE whatsapp_channels SET status = $2 WHERE id = $1', [row.channel_id, chStatus]);
      }
    }
  }
  return changed;
}

export function bridgeSummary(accountId: number) {
  const state = bridgeHub.state(accountId);
  return {
    connected: state.connected,
    connectedAt: state.connectedAt,
    lastHeartbeatAt: state.lastHeartbeatAt,
    extensionVersion: state.extensionVersion,
    containersDetected: state.containers.length,
    containers: state.containers.map((c) => ({
      name: c.name,
      cookieStoreId: c.cookieStoreId,
      waStatus: state.tabs.find((t) => t.cookieStoreId === c.cookieStoreId)?.status ?? 'not_open',
    })),
  };
}

/** Liga os eventos do bridge ao banco/tempo real. Chamado uma vez no boot. */
export function wireBridgeEvents() {
  bridgeHub.onChange(async (accountId, state, kind) => {
    try {
      const changed = await refreshFirefoxStatuses(accountId, state);
      if (kind !== 'heartbeat') {
        await log({
          accountId,
          level: kind === 'connected' ? 'info' : 'warn',
          category: 'firefox',
          action: kind === 'connected' ? 'bridge_connected' : 'bridge_disconnected',
          message: kind === 'connected' ? 'Firefox Bridge conectado' : 'Firefox Bridge desconectado',
          meta: { version: state.extensionVersion },
        });
        if (kind === 'connected') ensureContainers(accountId).catch(() => undefined);
      }
      realtime.emit(accountId, 'bridge.status', bridgeSummary(accountId));
      if (changed || kind !== 'heartbeat') await emitChannels(accountId);
    } catch (err) {
      console.error('[bridge] erro ao processar evento:', (err as Error).message);
    }
  });
}

