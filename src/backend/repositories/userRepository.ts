import { camel, camelAll, db, type Queryable } from '../../db/dbClient.js';
import type { User } from '../../shared/types.js';

const COLS = 'id, account_id, name, email, role, active, settings, last_login_at, created_at';

export const userRepository = {
  async count(): Promise<number> {
    return (await db().one<{ n: number }>('SELECT count(*)::int AS n FROM users')).n;
  },
  async findByEmailWithHash(email: string) {
    return db().maybeOne(`SELECT ${COLS}, password_hash FROM users WHERE lower(email) = lower($1)`, [email]);
  },
  async findById(id: number): Promise<User | null> {
    return camel(await db().maybeOne(`SELECT ${COLS} FROM users WHERE id = $1`, [id]));
  },
  async findHashById(id: number): Promise<string | null> {
    return (await db().maybeOne('SELECT password_hash FROM users WHERE id = $1', [id]))?.password_hash ?? null;
  },
  async listByAccount(accountId: number): Promise<User[]> {
    return camelAll(await db().query(`SELECT ${COLS} FROM users WHERE account_id = $1 ORDER BY name`, [accountId]));
  },
  async create(
    q: Queryable,
    data: { accountId: number; name: string; email: string; passwordHash: string; role: string },
  ): Promise<User> {
    const [row] = await q.query(
      `INSERT INTO users (account_id, name, email, password_hash, role) VALUES ($1,$2,lower($3),$4,$5) RETURNING ${COLS}`,
      [data.accountId, data.name, data.email, data.passwordHash, data.role],
    );
    return camel(row);
  },
  async update(
    accountId: number,
    id: number,
    data: Partial<{ name: string; email: string; role: string; active: boolean; settings: object; passwordHash: string }>,
  ): Promise<User | null> {
    const map: Record<string, string> = {
      name: 'name',
      email: 'email',
      role: 'role',
      active: 'active',
      settings: 'settings',
      passwordHash: 'password_hash',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined || !map[k]) continue;
      params.push(k === 'email' ? String(v).toLowerCase() : v);
      sets.push(`${map[k]} = $${params.length}`);
    }
    if (!sets.length) return this.findById(id);
    params.push(accountId, id);
    return camel(
      await db().maybeOne(
        `UPDATE users SET ${sets.join(', ')} WHERE account_id = $${params.length - 1} AND id = $${params.length} RETURNING ${COLS}`,
        params,
      ),
    );
  },
  async touchLogin(id: number) {
    await db().query('UPDATE users SET last_login_at = now() WHERE id = $1', [id]);
  },
};

export const sessionRepository = {
  async create(userId: number, tokenHash: string, expiresAt: Date, userAgent?: string, ip?: string) {
    await db().query(
      'INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip) VALUES ($1,$2,$3,$4,$5)',
      [userId, tokenHash, expiresAt, userAgent ?? null, ip ?? null],
    );
  },
  async findValid(tokenHash: string) {
    return db().maybeOne(
      `SELECT s.user_id, u.account_id, u.role, u.active, u.name, u.email FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash],
    );
  },
  async delete(tokenHash: string) {
    await db().query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  },
  async deleteAllForUser(userId: number, exceptHash?: string) {
    await db().query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, exceptHash ?? '']);
  },
  async purgeExpired() {
    await db().query('DELETE FROM sessions WHERE expires_at < now()');
  },
};
