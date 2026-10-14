/** Read-only migration ledger verification; never invokes migrations or API bootstrap. */
import type { DatabasePort } from '../src/application/ports/database.port';
import { canonical, need, sha } from './platform-content-release-core';
export interface MigrationRow { name: string; checksum: string }
export async function schemaReadback(db: DatabasePort, expectedDatabase: string, expected: MigrationRow[]) {
  need(expected.length > 0 && expected.every(r => /^[a-zA-Z0-9_-]+\.sql$/.test(r.name) && /^[a-f0-9]{64}$/.test(r.checksum))
    && new Set(expected.map(r => r.name)).size === expected.length, 'SCHEMA_EXPECTED_LEDGER');
  return db.withoutTenant(async s => {
    await s.query('SET TRANSACTION READ ONLY');
    const database = await s.query<{ database: string }>('SELECT current_database() AS database');
    need(database.rows[0]?.database === expectedDatabase, 'SCHEMA_DATABASE');
    const rows = (await s.query<MigrationRow>('SELECT name,checksum FROM _kernel_migrations ORDER BY name')).rows;
    const sorted = [...expected].sort((a,b) => a.name.localeCompare(b.name));
    need(canonical(rows) === canonical(sorted), 'SCHEMA_LEDGER_READBACK');
    return { schemaReadbackPassed: true, schemaLedgerSha256: sha(canonical(rows)), expectedLedgerSha256: sha(canonical(sorted)),
      migrationCount: rows.length, productionWrites: false };
  });
}
