// Cliente de banco único para toda a aplicação.
// - DATABASE_URL definido → PostgreSQL real (Supabase, Neon, Cloud SQL, Postgres local).
// - Sem DATABASE_URL     → PGlite (Postgres embarcado em WASM): em disco (PGLITE_DATA_DIR)
//                           ou em memória (PGLITE_DATA_DIR=memory) para desenvolvimento/testes.
// O mesmo schema.sql e as mesmas queries funcionam nos dois modos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { PGlite as PGliteType } from '@electric-sql/pglite';

export type Row = Record<string, any>;

export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  kind: 'postgres' | 'pglite';
  one<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T>;
  maybeOne<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T | null>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

const DATE_OID = 1082;
const INT8_OID = 20;
const NUMERIC_OID = 1700;

function withHelpers(base: Omit<Db, 'one' | 'maybeOne'>): Db {
  return {
    ...base,
    async one(sql, params) {
      const rows = await base.query(sql, params);
      if (!rows[0]) throw new Error('Registro não encontrado');
      return rows[0] as any;
    },
    async maybeOne(sql, params) {
      const rows = await base.query(sql, params);
      return (rows[0] as any) ?? null;
    },
  };
}

async function createPostgres(url: string): Promise<Db> {
  pg.types.setTypeParser(DATE_OID, (v) => v);
  pg.types.setTypeParser(INT8_OID, (v) => Number(v));
  pg.types.setTypeParser(NUMERIC_OID, (v) => Number(v));
  const ssl =
    process.env.DATABASE_SSL === 'false' || /localhost|127\.0\.0\.1/.test(url)
      ? undefined
      : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' };
  const pool = new pg.Pool({ connectionString: url, ssl, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
  pool.on('error', (err) => console.error('[db] erro no pool:', err.message));
  return withHelpers({
    kind: 'postgres',
    async query(sql, params = []) {
      const res = await pool.query(sql, params as any[]);
      return res.rows;
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          async query(sql, params = []) {
            return (await client.query(sql, params as any[])).rows;
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  });
}

async function createPglite(dataDir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const parsers = {
    [DATE_OID]: (v: string) => v,
    [INT8_OID]: (v: string) => Number(v),
    [NUMERIC_OID]: (v: string) => Number(v),
  };
  let db: PGliteType;
  if (dataDir === 'memory') {
    db = new PGlite({ parsers });
  } else {
    fs.mkdirSync(dataDir, { recursive: true });
    db = new PGlite(dataDir, { parsers });
  }
  await db.waitReady;
  return withHelpers({
    kind: 'pglite',
    async query(sql, params = []) {
      return (await db.query(sql, params as any[])).rows as any[];
    },
    async tx(fn) {
      return db.transaction(async (t) =>
        fn({
          async query(sql, params = []) {
            return (await t.query(sql, params as any[])).rows as any[];
          },
        }),
      );
    },
    async exec(sql) {
      await db.exec(sql);
    },
    async close() {
      await db.close();
    },
  });
}

let instance: Db | null = null;

export async function initDb(options: { databaseUrl?: string; dataDir?: string } = {}): Promise<Db> {
  if (instance) return instance;
  const url = options.databaseUrl ?? process.env.DATABASE_URL;
  if (url) {
    instance = await createPostgres(url);
  } else {
    const dir = options.dataDir ?? process.env.PGLITE_DATA_DIR ?? './data/pglite';
    instance = await createPglite(dir);
    console.log(
      `[db] DATABASE_URL não definido — usando PGlite ${dir === 'memory' ? 'em memória' : `em ${dir}`} (desenvolvimento).`,
    );
  }
  await migrate(instance);
  return instance;
}

export function db(): Db {
  if (!instance) throw new Error('Banco não inicializado. Chame initDb() antes.');
  return instance;
}

export async function closeDb(): Promise<void> {
  if (instance) await instance.close();
  instance = null;
}

function findSchemaFile(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.SCHEMA_PATH,
    path.resolve(process.cwd(), 'schema.sql'),
    path.resolve(here, '../../schema.sql'),
    path.resolve(here, '../../../schema.sql'),
  ].filter(Boolean) as string[];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('schema.sql não encontrado');
  return found;
}

export async function migrate(target: Db): Promise<void> {
  const sql = fs.readFileSync(findSchemaFile(), 'utf8');
  await target.exec(sql);
}

/** Converte linhas snake_case → camelCase e datas → ISO string. */
export function camel<T = any>(row: Row | null | undefined): T {
  if (!row) return row as any;
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    const key = k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    out[key] = v instanceof Date ? v.toISOString() : v;
  }
  return out as T;
}

export function camelAll<T = any>(rows: Row[]): T[] {
  return rows.map((r) => camel<T>(r));
}
