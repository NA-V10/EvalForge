import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Schema = typeof schema;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, Schema, any>;

export interface DatabaseHandle {
  db: Db;
  kind: "postgres" | "pglite";
  close(): Promise<void>;
}

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = resolve(here, "../migrations");
export const REPO_ROOT = resolve(here, "../../..");

/**
 * Connect to PostgreSQL when `DATABASE_URL` (or `url`) is a postgres URL; otherwise use embedded
 * PGlite (real Postgres compiled to WASM) persisted under `.data/pglite`, or `memory://` for tests.
 * Both run the same migrations — there is no separate "dev schema".
 */
export async function createDatabase(opts: { url?: string; migrate?: boolean } = {}): Promise<DatabaseHandle> {
  const url = opts.url ?? process.env.DATABASE_URL ?? `pglite://${resolve(REPO_ROOT, ".data/pglite")}`;
  const migrate = opts.migrate ?? true;

  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    const pg = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new pg.default.Pool({ connectionString: url, max: 10 });
    const db = drizzle(pool, { schema }) as unknown as Db;
    if (migrate) {
      const { migrate: run } = await import("drizzle-orm/node-postgres/migrator");
      await run(db as never, { migrationsFolder: MIGRATIONS_DIR });
    }
    return { db, kind: "postgres", close: () => pool.end() };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  let client;
  if (url === "memory://" || url === "pglite://memory") {
    client = new PGlite();
  } else {
    const dir = url.replace(/^pglite:\/\//, "");
    mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
  }
  const db = drizzle(client, { schema }) as unknown as Db;
  if (migrate) {
    const { migrate: run } = await import("drizzle-orm/pglite/migrator");
    await run(db as never, { migrationsFolder: MIGRATIONS_DIR });
  }
  return { db, kind: "pglite", close: () => client.close() };
}
