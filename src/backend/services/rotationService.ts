// Ponteiro persistente do rodízio (sobrevive a refresh, navegador fechado e restart do backend).
import { db, type Queryable } from '../../db/dbClient.js';
import { channelLabel } from '../../shared/constants.js';
import { pickNextChannel, previewRotation } from '../../shared/rotation.js';
import { bridgeHub } from '../integrations/firefox/bridgeHub.js';
import { channelRepository, type ChannelRow } from '../repositories/channelRepository.js';
import { channelAvailability } from './channelService.js';

export async function getPointer(accountId: number, q: Queryable = db()): Promise<{ lastOrderIndex: number; lastChannelId: number | null }> {
  const [row] = await q.query('SELECT last_order_index, last_channel_id FROM rotation_state WHERE account_id = $1', [accountId]);
  if (!row) {
    await q.query('INSERT INTO rotation_state (account_id) VALUES ($1) ON CONFLICT DO NOTHING', [accountId]);
    return { lastOrderIndex: 0, lastChannelId: null };
  }
  return { lastOrderIndex: row.last_order_index, lastChannelId: row.last_channel_id };
}

export async function advancePointer(q: Queryable, accountId: number, channel: { id: number; orderIndex: number }) {
  await q.query(
    `INSERT INTO rotation_state (account_id, last_order_index, last_channel_id, updated_at) VALUES ($1,$2,$3,now())
     ON CONFLICT (account_id) DO UPDATE SET last_order_index = $2, last_channel_id = $3, updated_at = now()`,
    [accountId, channel.orderIndex, channel.id],
  );
}

export function candidatesFor(channels: ChannelRow[], accountId: number, allowedIds?: number[] | null) {
  const bridgeConnected = bridgeHub.isConnected(accountId);
  return channels
    .filter((c) => !allowedIds?.length || allowedIds.includes(c.id))
    .map((c) => {
      const availability = channelAvailability(c, { bridgeConnected, forAutomatic: true });
      return { ...c, available: availability.available, reason: availability.reason };
    });
}

/** Escolhe o próximo canal no momento do processamento (não pré-distribui). */
export async function chooseChannel(accountId: number, allowedIds?: number[] | null) {
  const channels = await channelRepository.list(accountId);
  const candidates = candidatesFor(channels, accountId, allowedIds);
  const { lastOrderIndex } = await getPointer(accountId);
  return { channel: pickNextChannel(candidates, lastOrderIndex), candidates };
}

/** Estado do rodízio para o Monitor e para a pré-visualização de campanhas. */
export async function rotationOverview(accountId: number, allowedIds?: number[] | null, previewCount = 8) {
  const channels = await channelRepository.list(accountId);
  const candidates = candidatesFor(channels, accountId, allowedIds);
  const pointer = await getPointer(accountId);
  const sequence = previewRotation(candidates, pointer.lastOrderIndex, previewCount);
  const last = channels.find((c) => c.id === pointer.lastChannelId) ?? null;
  return {
    lastChannel: last ? { id: last.id, label: last.label } : pointer.lastOrderIndex ? { id: null, label: channelLabel(pointer.lastOrderIndex) } : null,
    nextChannel: sequence[0] ? { id: sequence[0].id, label: sequence[0].label, container: sequence[0].container?.name ?? null } : null,
    sequence: sequence.map((c) => ({ id: c.id, label: c.label, container: c.container?.name ?? null })),
    skipped: candidates.filter((c) => !c.available).map((c) => ({ id: c.id, label: c.label, reason: c.reason })),
    activeCount: candidates.filter((c) => c.available).length,
  };
}
