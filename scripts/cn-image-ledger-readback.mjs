// Image-only admission: no migrations, seeds, DDL or data writes.
import fs from 'node:fs';
import pg from 'pg';
import {migrationConfig} from './src/infrastructure/db/pg-config.ts';
const expected = JSON.parse(fs.readFileSync(0, 'utf8'));
const config = migrationConfig();
const need = v => { if (!v) throw new Error('REJECTED'); };
need(config.host === expected.PGHOST && String(config.port) === expected.PGPORT &&
  config.database === expected.PGDATABASE && config.user === 'migration_admin');
const client = new pg.Client({...config, connectionTimeoutMillis:5000, statement_timeout:10000});
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const identity = (await client.query('SELECT current_database() AS database, current_user AS role')).rows[0];
  need(identity.database === expected.PGDATABASE && identity.role === config.user);
  const ledger = (await client.query('SELECT name,checksum FROM public._kernel_migrations ORDER BY name')).rows;
  const count = (await client.query('SELECT count(*)::integer AS n FROM public._kernel_migrations')).rows[0].n;
  await client.query('ROLLBACK');
  console.log(JSON.stringify({status:'COMPLETE',readOnly:true,count,ledger}));
} catch {
  process.stderr.write('CN_LEDGER_READBACK_FAILED\n');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
