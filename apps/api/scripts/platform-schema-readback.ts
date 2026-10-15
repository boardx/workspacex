/** Root-controlled schema observer. Existing migration environment; no startup or writes. */
import { constants, openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { PgDatabase } from '../src/infrastructure/db/pg-database';
import { migrationConfig } from '../src/infrastructure/db/pg-config';
import { migrationFiles, MIGRATIONS_DIR } from '../src/infrastructure/db/migrator';
import { canonical, need, sha } from './platform-content-release-core';
import { schemaReadback } from './platform-schema-readback-core';
async function main() {
 const [path, pin, source] = process.argv.slice(2);
 need(process.argv.length === 5 && path && pin && /^[a-f0-9]{64}$/.test(pin) && source && /^[a-f0-9]{40}$/.test(source), 'SCHEMA_CLI_INPUT');
 need(process.getuid?.() === 0,'ROOT_EXECUTION_REQUIRED');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);let raw:Buffer;
 try { const st=fstatSync(fd);need(st.isFile() && st.uid===0 && st.nlink===1 && (st.mode&0o077)===0 && st.size<=65536,'ROOT_PRIVATE_INPUT_REQUIRED');raw=readFileSync(fd); } finally {closeSync(fd);}
 need(sha(raw)===pin,'SCHEMA_REQUEST_CHANGED');const request=JSON.parse(raw.toString('utf8'));
 need(request.kind==='cn-mvp-schema-request-v1' && request.identity.sourceRevision===source && request.expectedDatabase==='workspacex_a1cb_20261006'
  && Number.isSafeInteger(request.productionRunId) && request.productionRunId>0,'SCHEMA_SCOPE');
 const expected=migrationFiles().map(name=>({name,checksum:sha(readFileSync(join(MIGRATIONS_DIR,name)))}));
 need(sha(canonical(expected))===request.expectedLedgerSha256,'SOURCE_MIGRATION_LEDGER');
 const config=migrationConfig();need(config.database===request.expectedDatabase,'SCHEMA_CONNECTION_DATABASE');const db=new PgDatabase(config,{info(){},error(){},drain:()=>[]});
 try {console.log(JSON.stringify({kind:'cn-mvp-schema-readback-v1',identity:request.identity,productionRunId:request.productionRunId,
  requestSha256:pin,observedAt:new Date().toISOString(),...(await schemaReadback(db,request.expectedDatabase,expected))}));}finally{await db.close();}
}
main().catch(()=>{console.log('{"status":"REJECTED_OR_UNKNOWN","productionWrites":false}');process.exitCode=20;});
