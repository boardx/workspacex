/** Explicit fresh-database preparation inside with-test-isolation; no assertions run here. */
import { ensureDatabase, migrateOnce } from './db';
import { assertIsolatedDatabase } from '../../../../.harness/scripts/lib/test-isolation';
import { migrationConfig } from '../../src/infrastructure/db/pg-config';
assertIsolatedDatabase({ resolvedDatabase: migrationConfig().database ?? '', env: process.env });
const start=Date.now();
ensureDatabase();
console.log(`[catalog-review-prepare] ensureDatabase=${Date.now()-start}ms`);
void migrateOnce().then(()=>console.log(`[catalog-review-prepare] migrateOnceTotal=${Date.now()-start}ms`)).catch(error=>{console.error(error);process.exitCode=1;});
