// Armazenamento seguro de credenciais de integração (criptografadas; nunca devolvidas em texto puro).
import { camel, db } from '../../db/dbClient.js';
import { decrypt, encrypt, last4 } from '../lib/crypto.js';

export type Provider = 'casa_dos_dados' | 'evolution';

export interface CredentialInfo {
  provider: Provider;
  configured: boolean;
  source: 'database' | 'env' | 'none';
  masked: string | null;
  status: string;
  lastCheckedAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
  usageToday: number;
  meta: Record<string, unknown>;
}

export function mask(l4: string | null | undefined): string | null {
  return l4 ? `••••••••${l4}` : null;
}

export const credentialService = {
  async set(accountId: number, provider: Provider, value: string, meta: Record<string, unknown> = {}) {
    await db().query(
      `INSERT INTO api_credentials (account_id, provider, encrypted_value, last4, meta, status, last_error, updated_at)
       VALUES ($1,$2,$3,$4,$5,'unknown',NULL,now())
       ON CONFLICT (account_id, provider) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value,
         last4 = EXCLUDED.last4, meta = api_credentials.meta || EXCLUDED.meta, status = 'unknown', last_error = NULL, updated_at = now()`,
      [accountId, provider, encrypt(value), last4(value), meta],
    );
  },
  async setMeta(accountId: number, provider: Provider, meta: Record<string, unknown>) {
    await db().query(
      `UPDATE api_credentials SET meta = meta || $3, updated_at = now() WHERE account_id = $1 AND provider = $2`,
      [accountId, provider, meta],
    );
  },
  async remove(accountId: number, provider: Provider) {
    await db().query('DELETE FROM api_credentials WHERE account_id = $1 AND provider = $2', [accountId, provider]);
  },
  /** Valor em texto puro — uso exclusivo do backend. */
  async getSecret(accountId: number, provider: Provider, envFallback = ''): Promise<string> {
    const row = await db().maybeOne(
      'SELECT encrypted_value FROM api_credentials WHERE account_id = $1 AND provider = $2',
      [accountId, provider],
    );
    if (row) {
      try {
        return decrypt(row.encrypted_value);
      } catch {
        return envFallback;
      }
    }
    return envFallback;
  },
  async getRow(accountId: number, provider: Provider) {
    return db().maybeOne('SELECT * FROM api_credentials WHERE account_id = $1 AND provider = $2', [accountId, provider]);
  },
  async info(accountId: number, provider: Provider, envValue = ''): Promise<CredentialInfo> {
    const row = camel<any>(await this.getRow(accountId, provider));
    const today = new Date().toISOString().slice(0, 10);
    if (row) {
      return {
        provider,
        configured: true,
        source: 'database',
        masked: mask(row.last4),
        status: row.status,
        lastCheckedAt: row.lastCheckedAt,
        lastUsedAt: row.lastUsedAt,
        lastError: row.lastError,
        usageToday: row.usageDate === today ? row.usageToday : 0,
        meta: row.meta ?? {},
      };
    }
    return {
      provider,
      configured: !!envValue,
      source: envValue ? 'env' : 'none',
      masked: envValue ? mask(last4(envValue)) : null,
      status: envValue ? 'unknown' : 'not_configured',
      lastCheckedAt: null,
      lastUsedAt: null,
      lastError: null,
      usageToday: 0,
      meta: {},
    };
  },
  async markStatus(accountId: number, provider: Provider, status: 'ok' | 'error', error?: string | null) {
    await db().query(
      `UPDATE api_credentials SET status = $3, last_error = $4, last_checked_at = now() WHERE account_id = $1 AND provider = $2`,
      [accountId, provider, status, error ?? null],
    );
  },
  /** Incrementa o uso diário e devolve o total do dia. */
  async registerUsage(accountId: number, provider: Provider, amount = 1): Promise<number> {
    const row = await db().maybeOne(
      `UPDATE api_credentials SET
         usage_today = CASE WHEN usage_date = CURRENT_DATE THEN usage_today + $3 ELSE $3 END,
         usage_date = CURRENT_DATE, last_used_at = now()
       WHERE account_id = $1 AND provider = $2 RETURNING usage_today`,
      [accountId, provider, amount],
    );
    return row?.usage_today ?? amount;
  },
  async usageToday(accountId: number, provider: Provider): Promise<number> {
    const row = await db().maybeOne(
      `SELECT CASE WHEN usage_date = CURRENT_DATE THEN usage_today ELSE 0 END AS n
       FROM api_credentials WHERE account_id = $1 AND provider = $2`,
      [accountId, provider],
    );
    return row?.n ?? 0;
  },
};
