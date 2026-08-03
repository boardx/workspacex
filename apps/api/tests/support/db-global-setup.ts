import pg from "pg";
import { assertDatabaseCapacity } from "../../../../.harness/scripts/lib/test-isolation";
import { migrationConfig } from "../../src/infrastructure/db/pg-config";
import { ensureDatabase } from "./db";

interface CapacityRow {
  max_connections: number;
  reserved_connections: number;
  current_connections: number;
}

export default async function databaseGlobalSetup(): Promise<() => Promise<void>> {
  ensureDatabase();

  const capacityClient = new pg.Client(migrationConfig());
  await capacityClient.connect();
  const capacity = await capacityClient.query<CapacityRow>(`
    SELECT current_setting('max_connections')::int AS max_connections,
           current_setting('superuser_reserved_connections')::int AS reserved_connections,
           (SELECT count(*)::int FROM pg_stat_activity) AS current_connections
  `);
  await capacityClient.end();
  const row = capacity.rows[0];
  if (!row) throw new Error("PostgreSQL capacity probe returned no row");
  const requiredConnections = Number(process.env.WORKSPACEX_DB_CONNECTION_BUDGET ?? "32");
  assertDatabaseCapacity({
    maxConnections: row.max_connections,
    reservedConnections: row.reserved_connections,
    currentConnections: row.current_connections,
    requiredConnections,
  });

  const database = migrationConfig().database;
  const monitor = new pg.Client(migrationConfig());
  await monitor.connect();
  let peakConnections = 0;
  let sampling = false;
  const sample = async (): Promise<void> => {
    if (sampling) return;
    sampling = true;
    try {
      const result = await monitor.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1",
        [database],
      );
      peakConnections = Math.max(peakConnections, result.rows[0]?.count ?? 0);
    } finally {
      sampling = false;
    }
  };
  await sample();
  const timer = setInterval(() => void sample(), 50);

  console.log(
    `[db-isolation] db=${database} capacity=${row.max_connections} ` +
    `current=${row.current_connections} required=${requiredConnections}`,
  );

  return async () => {
    clearInterval(timer);
    while (sampling) await new Promise((resolve) => setTimeout(resolve, 10));
    await sample();
    await monitor.end();
    console.log(`[db-isolation] db=${database} peak_connections=${peakConnections}`);
  };
}
