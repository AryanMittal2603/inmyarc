import { neon } from '@neondatabase/serverless';
import { env } from './env.js';
import { HttpError } from './http.js';
import { SCHEMA, SCHEMA_VERSION } from './schema.js';

/** The tiny query interface the API needs. Neon in production, PGlite in tests. */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

let current: Db | null = null;
let schemaReady: Promise<void> | null = null;

/** Swap the connection (used by tests). */
export function setDb(db: Db | null): void {
  current = db;
  schemaReady = null;
}

export function hasDatabase(): boolean {
  return current !== null || env.databaseUrl() !== '';
}

function connect(): Db {
  if (current) return current;
  const url = env.databaseUrl();
  if (!url) throw new HttpError(503, 'The database is not connected yet.', 'no_database');
  const sql = neon(url);
  current = {
    query: async <T>(text: string, params: unknown[] = []) => (await sql.query(text, params)) as T[],
  };
  return current;
}

async function ensureSchema(db: Db): Promise<void> {
  const [reg] = await db.query<{ ok: boolean }>(`select to_regclass('public.settings') is not null as ok`);
  if (reg?.ok) {
    const [row] = await db.query<{ value: string | null }>(`select value from settings where key = 'schema_version'`);
    if (row?.value === SCHEMA_VERSION) return;
  }
  for (const statement of SCHEMA) {
    await db.query(statement);
  }
  await db.query(
    `insert into settings (key, value) values ('schema_version', $1)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [SCHEMA_VERSION],
  );
}

/** A ready-to-use connection with the schema in place. */
export async function db(): Promise<Db> {
  const connection = connect();
  if (!schemaReady) {
    schemaReady = ensureSchema(connection).catch(async (error) => {
      // Two cold starts can race on the first run; one retry settles it.
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        await ensureSchema(connection);
      } catch {
        schemaReady = null;
        throw error;
      }
    });
  }
  await schemaReady;
  return connection;
}
