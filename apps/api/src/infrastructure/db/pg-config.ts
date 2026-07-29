/**
 * Connection configuration. The application identity and the migration identity are
 * two different roles, deliberately kept apart.
 *
 * | identity       | purpose                | hard constraints                       |
 * |----------------|------------------------|----------------------------------------|
 * | migration role | run DDL, owns tables   | used only during migration             |
 * | application    | runtime reads/writes   | NOT a table owner, no BYPASSRLS, no DDL|
 *
 * In PostgreSQL a table owner bypasses RLS by default. Collapsing these two into one
 * connection string is the number one cause of "we thought RLS was on but it wasn't"
 * (UC-0.6 R7 / domain I-4).
 */
export interface PgConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`missing env var ${name}`);
  return v;
}

/** The APPLICATION identity used at runtime */
export function appConfig(): PgConfig {
  return {
    host: req("PGHOST", "127.0.0.1"),
    port: Number(req("PGPORT", "55432")),
    database: req("PGDATABASE", "workspacex"),
    user: req("APP_DB_USER", "app_rw"),
    password: req("APP_DB_PASSWORD", "app_rw_dev"),
  };
}

/** The OWNER identity, used only while migrating */
export function migrationConfig(): PgConfig {
  return {
    host: req("PGHOST", "127.0.0.1"),
    port: Number(req("PGPORT", "55432")),
    database: req("PGDATABASE", "workspacex"),
    user: req("MIGRATION_DB_USER", "postgres"),
    password: req("MIGRATION_DB_PASSWORD", "postgres_dev"),
  };
}
