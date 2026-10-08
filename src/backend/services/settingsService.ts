// Configurações da conta: token do Firefox Bridge e preferências.
import { db } from '../../db/dbClient.js';
import { last4, randomToken, safeEqual, sha256 } from '../lib/crypto.js';
import { log } from './logService.js';

export async function generateBridgeToken(accountId: number, userId: number) {
  const token = `mzb_${randomToken(24)}`;
  await db().query('UPDATE accounts SET bridge_token_hash = $2, bridge_token_last4 = $3 WHERE id = $1', [accountId, sha256(token), last4(token)]);
  await log({ accountId, userId, category: 'security', action: 'bridge_token', message: 'Novo token do Firefox Bridge gerado' });
  return token;
}

export async function bridgeTokenInfo(accountId: number) {
  const row = await db().one('SELECT bridge_token_last4 FROM accounts WHERE id = $1', [accountId]);
  return { configured: !!row.bridge_token_last4, masked: row.bridge_token_last4 ? `mzb_••••••${row.bridge_token_last4}` : null };
}

/** Valida o token apresentado pela extensão e devolve a conta. */
export async function accountForBridgeToken(token: string): Promise<number | null> {
  if (!token || !token.startsWith('mzb_')) return null;
  const hash = sha256(token);
  const row = await db().maybeOne('SELECT id, bridge_token_hash FROM accounts WHERE bridge_token_hash = $1', [hash]);
  return row && safeEqual(row.bridge_token_hash, hash) ? row.id : null;
}

export async function getAccount(accountId: number) {
  const row = await db().one('SELECT id, name, settings, created_at FROM accounts WHERE id = $1', [accountId]);
  return { id: row.id, name: row.name, settings: row.settings ?? {}, createdAt: row.created_at };
}

export async function updateAccount(accountId: number, userId: number, data: { name?: string; settings?: Record<string, unknown> }) {
  await db().query('UPDATE accounts SET name = COALESCE($2, name), settings = settings || $3 WHERE id = $1', [accountId, data.name ?? null, data.settings ?? {}]);
  await log({ accountId, userId, category: 'settings', action: 'account_updated', message: 'Configurações da conta atualizadas' });
  return getAccount(accountId);
}
