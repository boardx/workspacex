import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import Redis from "ioredis";
import { appConfig } from "../src/infrastructure/db/pg-config";
import { migrationFiles, MIGRATIONS_DIR } from "../src/infrastructure/db/migrator";
import { redisConfig } from "../src/infrastructure/auth/redis-session-token-store";

let database: pg.Client | undefined;
let cache: Redis | undefined;
try {
  database = new pg.Client(appConfig());
  await database.connect();
  const roles = await database.query<{ unsafe: boolean }>(`SELECT rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole AS unsafe FROM pg_roles WHERE rolname=current_user`);
  if (roles.rows[0]?.unsafe !== false) throw new Error("unsafe role");
  const tables = await database.query<{ unsafe: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR (c.relrowsecurity AND NOT c.relforcerowsecurity))) AS unsafe`);
  if (tables.rows[0]?.unsafe !== false) throw new Error("unsafe tables");
  const applied = await database.query<{ name: string; checksum: string }>("SELECT name,checksum FROM _kernel_migrations");
  const checksums = new Map(applied.rows.map(row => [row.name, row.checksum]));
  const files = migrationFiles();
  if (files.length === 0 || files.some(name => checksums.get(name) !== createHash("sha256").update(readFileSync(join(MIGRATIONS_DIR, name))).digest("hex"))) throw new Error("schema not current");
  cache = new Redis({ ...redisConfig(), lazyConnect: true, enableOfflineQueue: false,
    retryStrategy: () => null, connectTimeout: 5000, commandTimeout: 5000 });
  cache.on("error", () => undefined);
  await cache.connect();
  if (await cache.ping() !== "PONG") throw new Error("cache not ready");
  console.log(JSON.stringify({ ok: true, database: true, migrations: true, redis: true, cloudVerified: false }));
} catch {
  console.error(JSON.stringify({ ok: false, reason: "data_dependencies_not_ready" }));
  process.exitCode = 1;
} finally { cache?.disconnect(); await database?.end(); }
