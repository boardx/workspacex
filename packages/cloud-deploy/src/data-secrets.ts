import { z } from "zod";

const password = z.string().min(16).max(4096).refine(v => !/[\r\n\0]/.test(v));
const connection = { host: z.string().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/), port: z.number().int().min(1).max(65535).default(5432), database: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/) };
/** Contents of databaseSecretRef; credentials are not rendered into public plan output. */
export const DatabaseSecret = z.object({ ...connection, user: z.literal("app_rw"), password,
  diagnosticsUser: z.literal("app_diag_ro"), diagnosticsPassword: password,
  caFile: z.string().startsWith("/").optional(),
}).strict();
export const MigrationSecret = z.object({ ...connection, user: z.string().min(1).max(63), password }).strict();
export const RedisSecret = z.object({ host: connection.host, port: z.number().int().min(1).max(65535).default(6379), username: z.string().min(1).optional(), password }).strict();

export function productionDataEnvironment(database: unknown, migration: unknown, redis: unknown): Record<string, string> {
  const db = DatabaseSecret.safeParse(database), owner = MigrationSecret.safeParse(migration), cache = RedisSecret.safeParse(redis);
  if (!db.success || !owner.success || !cache.success) throw new Error("invalid production data secret fields");
  if (["host", "port", "database"].some(key => db.data[key as keyof typeof connection] !== owner.data[key as keyof typeof connection]) ||
    [db.data.user, db.data.diagnosticsUser].includes(owner.data.user as "app_rw" | "app_diag_ro")) throw new Error("database identities must be separate on the same database");
  return { PGHOST: db.data.host, PGPORT: String(db.data.port), PGDATABASE: db.data.database,
    APP_DB_USER: db.data.user, APP_DB_PASSWORD: db.data.password,
    DIAG_DB_USER: db.data.diagnosticsUser, DIAG_DB_PASSWORD: db.data.diagnosticsPassword,
    MIGRATION_DB_USER: owner.data.user, MIGRATION_DB_PASSWORD: owner.data.password,
    PGSSLMODE: "verify-full", ...(db.data.caFile ? { PGSSLROOTCERT: db.data.caFile } : {}),
    REDIS_HOST: cache.data.host, REDIS_PORT: String(cache.data.port), REDIS_PASSWORD: cache.data.password,
    ...(cache.data.username ? { REDIS_USERNAME: cache.data.username } : {}), REDIS_TLS: "true" };
}
