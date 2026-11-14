import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { type PgDatabase, type PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import * as schema from './schema';

export type MdlDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
export type DbDriver = 'postgres' | 'pglite';

export interface DatabaseContext {
  driver: DbDriver;
  db: MdlDatabase;
  pool: pg.Pool | null;
  pglite: PGlite | null;
  ensureMigrated: (migrationsFolder?: string) => Promise<void>;
  closeDb: () => Promise<void>;
}

function resolveMigrationsDir(): string {
  const fromModule = fileURLToPath(new URL('../../../../drizzle', import.meta.url));
  if (existsSync(fromModule)) {
    return fromModule;
  }
  const fromCwd = resolve(process.cwd(), 'drizzle');
  if (existsSync(fromCwd)) {
    return fromCwd;
  }
  const fromMonorepoCwd = resolve(process.cwd(), 'apps/web/drizzle');
  if (existsSync(fromMonorepoCwd)) {
    return fromMonorepoCwd;
  }
  throw new Error(
    `Migrations directory not found (checked ${fromModule}, ${fromCwd} and ${fromMonorepoCwd}).`
  );
}

function isPostgresUrl(url: string | undefined): url is string {
  if (!url) return false;
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}

function resolvePgliteTarget(databaseUrl: string | undefined): string {
  const trimmed = databaseUrl?.trim();
  if (trimmed === 'pglite://memory' || trimmed === 'memory://' || trimmed === ':memory:') {
    return 'memory://';
  }
  if (trimmed?.startsWith('pglite://')) {
    const rawPath = trimmed.slice('pglite://'.length) || './data/pgdata';
    const resolved = resolve(rawPath);
    mkdirSync(resolved, { recursive: true });
    return resolved;
  }
  const fallback = resolve(process.env.PGLITE_DATA_DIR?.trim() || './data/pgdata');
  mkdirSync(fallback, { recursive: true });
  return fallback;
}

export function createDatabase(customDatabaseUrl?: string): DatabaseContext {
  const databaseUrl = customDatabaseUrl ?? process.env.DATABASE_URL?.trim();
  let migrationPromise: Promise<void> | null = null;
  let closed = false;

  if (isPostgresUrl(databaseUrl)) {
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      max: Number(process.env.PG_POOL_MAX ?? 10)
    });
    const pgDb: NodePgDatabase<typeof schema> = drizzlePg(pool, { schema });
    const db = pgDb as unknown as MdlDatabase;

    const ensureMigratedFn = async (migrationsFolder = resolveMigrationsDir()): Promise<void> => {
      if (!migrationPromise) {
        migrationPromise = migratePg(pgDb, { migrationsFolder }).catch((err) => {
          migrationPromise = null;
          throw err;
        });
      }
      await migrationPromise;
    };

    const closeFn = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await pool.end();
    };

    return {
      driver: 'postgres',
      db,
      pool,
      pglite: null,
      ensureMigrated: ensureMigratedFn,
      closeDb: closeFn
    };
  }

  const pgliteTarget = resolvePgliteTarget(databaseUrl);
  const pglite = new PGlite(pgliteTarget);
  const pgliteDb: PgliteDatabase<typeof schema> = drizzlePglite(pglite, { schema });
  const db = pgliteDb as unknown as MdlDatabase;

  const ensureMigratedFn = async (migrationsFolder = resolveMigrationsDir()): Promise<void> => {
    if (!migrationPromise) {
      migrationPromise = (async () => {
        await pglite.waitReady;
        await migratePglite(pgliteDb, { migrationsFolder });
      })().catch((err) => {
        migrationPromise = null;
        throw err;
      });
    }
    await migrationPromise;
  };

  const closeFn = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await pglite.waitReady;
    await pglite.close();
  };

  return {
    driver: 'pglite',
    db,
    pool: null,
    pglite,
    ensureMigrated: ensureMigratedFn,
    closeDb: closeFn
  };
}

const defaultContext = createDatabase();

export const db: MdlDatabase = defaultContext.db;
export const dbDriver: DbDriver = defaultContext.driver;
export const pool: pg.Pool | null = defaultContext.pool;
export const pglite: PGlite | null = defaultContext.pglite;

export async function ensureMigrated(migrationsFolder?: string): Promise<void> {
  return defaultContext.ensureMigrated(migrationsFolder);
}

export async function closeDb(): Promise<void> {
  return defaultContext.closeDb();
}

export * from './schema';
