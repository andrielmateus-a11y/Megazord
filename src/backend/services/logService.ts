// Registro de auditoria/operação em system_logs. Nunca registra segredos.
import { camelAll, db } from '../../db/dbClient.js';
import { redact } from '../lib/redact.js';
import { realtime } from './realtime.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogInput {
  accountId?: number | null;
  userId?: number | null;
  level?: LogLevel;
  category: string;
  action: string;
  message?: string;
  meta?: Record<string, unknown>;
}

export async function log(input: LogInput): Promise<void> {
  const level = input.level ?? 'info';
  const meta = input.meta ? (redact(input.meta) as Record<string, unknown>) : null;
  try {
    const row = await db().one(
      `INSERT INTO system_logs (account_id, user_id, level, category, action, message, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
      [input.accountId ?? null, input.userId ?? null, level, input.category, input.action, input.message ?? null, meta],
    );
    if (input.accountId) {
      realtime.emit(input.accountId, 'log.new', {
        id: row.id,
        level,
        category: input.category,
        action: input.action,
        message: input.message,
        meta,
        createdAt: row.created_at,
      });
    }
  } catch (err) {
    console.error('[log] falha ao gravar log:', (err as Error).message);
  }
  if (level === 'error') console.error(`[${input.category}] ${input.action}: ${input.message ?? ''}`);
}

export async function listLogs(
  accountId: number,
  opts: { category?: string; level?: string; limit?: number; channelId?: number } = {},
) {
  const where = ['account_id = $1'];
  const params: unknown[] = [accountId];
  if (opts.category) {
    params.push(opts.category);
    where.push(`category = $${params.length}`);
  }
  if (opts.level) {
    params.push(opts.level);
    where.push(`level = $${params.length}`);
  }
  if (opts.channelId) {
    params.push(String(opts.channelId));
    where.push(`meta->>'channelId' = $${params.length}`);
  }
  params.push(Math.min(opts.limit ?? 200, 1000));
  const rows = await db().query(
    `SELECT id, user_id, level, category, action, message, meta, created_at FROM system_logs
     WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT $${params.length}`,
    params,
  );
  return camelAll(rows);
}
