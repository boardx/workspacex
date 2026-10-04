/** Cloud Assistant's fixed readonly producer. No migration/write SQL here. */
import pg from 'pg';
import { createHash } from 'node:crypto';import { gzipSync } from 'node:zlib';
import { readProtectedCompletionBytes } from '../cn-migration-completion-cli';
import { migrationSourceSchema,sourceEvidenceSchema,verifyExternalSourceIdentity } from '../cn-migration-source-identity';
import {migrationLedgerDigest}from '../cn-migration-snapshot';
import { verifyMigrationPeer } from './pinned-app-9b/migration-pg';
import {READ_QUERIES}from '../../../../.harness/scripts/vm/control_connection.cjs';
export const READONLY_LEDGER_SQL=["BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY","SELECT name,checksum FROM _kernel_migrations ORDER BY name","SELECT count(*)::integer AS count FROM _kernel_migrations","ROLLBACK"] as const;
export async function verifyDiagnosticReadonlyRole(client:Pick<pg.Client,'query'>,sourceUser:string){
 const value=await client.query(READ_QUERIES.roles!);const results=Array.isArray(value)?value:[value];const rows=results.flatMap(result=>result.rows??[]);
 if(rows.length!==1)throw new Error('DIAGNOSTIC_ROLE_PROOF_INCOMPLETE');const proof=Object.values(rows[0]!)[0] as any;
 const role=proof?.roles?.find((r:any)=>r.name===sourceUser);const names=['databaseWrite','schemaWrite','tableWrite','sequenceWrite','definerExecute','privilegedMembership'];
 if(proof?.currentRole!==sourceUser||!role||['superuser','createRole','createDb','replication','bypassRls'].some(key=>role[key]!==false)||!proof.diagnosticPrivileges||Object.keys(proof.diagnosticPrivileges).sort().join(',')!==names.sort().join(',')||names.some(key=>proof.diagnosticPrivileges[key]!==false))throw new Error('DIAGNOSTIC_ROLE_NOT_READONLY');
}
export async function collectReadonlyLedger(client: Pick<pg.Client,'query'>,source:unknown,querySha256:string){
 const intended=migrationSourceSchema.parse(source);if(!/^[a-f0-9]{64}$/.test(querySha256))throw new Error('READONLY_QUERY_HASH');
 await client.query(READONLY_LEDGER_SQL[0]);
 try{
  const rows=await client.query(READONLY_LEDGER_SQL[1]);const count=await client.query(READONLY_LEDGER_SQL[2]);
  if(count.rows.length!==1||count.rows[0].count!==rows.rows.length)throw new Error('READONLY_QUERY_COUNT');
  return {schemaVersion:2,kind:'cn-migration-ledger-output',querySha256,readOnly:true,transactionIsolation:'repeatable read',source:intended,independentSqlCount:count.rows[0].count,ledger:rows.rows,ledgerSha256:migrationLedgerDigest(rows.rows)};
 }finally{await client.query(READONLY_LEDGER_SQL[3]);}
}
export async function main(args:readonly string[]){
 if(process.getuid?.()!==0||process.platform!=='linux'||args.length!==3||args[0]!=='--readonly-ledger'||!/^[a-f0-9]{40}$/.test(args[1]!)||!/^[A-Za-z0-9-]{1,128}$/.test(args[2]!))throw new Error('READONLY_QUERY_ADMISSION');
 const directory=`/etc/workspacex-cn/maintenance-migration/${args[1]}/${args[2]}`;
 const plan=JSON.parse(readProtectedCompletionBytes(directory+'/query.json').toString('utf8'));
 const profile=JSON.parse(readProtectedCompletionBytes('/etc/workspacex-cn/trusted-tool-binding.json').toString('utf8'));
 const artifact='/usr/local/lib/workspacex-cn/cn-migration-snapshot-query.cjs';
 if(plan.toolRevision!==profile.toolRevision||profile.installedFilesSha256?.[artifact]!==createHash('sha256').update(readProtectedCompletionBytes(artifact,0o700)).digest('hex'))throw new Error('READONLY_QUERY_TOOL_CLOSURE');
 if(plan.readonlyCollectionAuthorized!==true||plan.identity.sourceRevision!==args[1]||plan.identity.attemptId!==args[2])throw new Error('READONLY_QUERY_IDENTITY');
 const source=migrationSourceSchema.parse(plan.source);const evidence=sourceEvidenceSchema.parse(plan.sourceEvidence);
 if(!verifyExternalSourceIdentity(source,evidence))throw new Error('READONLY_QUERY_EXTERNAL_IDENTITY');
 const raw=readProtectedCompletionBytes(directory+'/diagnostic-config.json');if(createHash('sha256').update(raw).digest('hex')!==plan.configSha256)throw new Error('READONLY_QUERY_CONFIGURATION');
 const cfg=JSON.parse(raw.toString('utf8'));if(Object.keys(cfg).sort().join(',')!=='connectionTimeoutMillis,database,host,password,port,ssl,statement_timeout,user'||cfg.database!==source.database||cfg.user!==source.user||cfg.host!==evidence.configuration.host||cfg.port!==evidence.configuration.port||(source.sslMode==='verify-full'?(cfg.ssl?.rejectUnauthorized!==true||typeof cfg.ssl.ca!=='string'||!cfg.ssl.ca):cfg.ssl!==false))throw new Error('READONLY_QUERY_CONFIGURATION');
 const client=new pg.Client(cfg);await client.connect();
 try{
  const fact=await client.query('SELECT current_database() AS database,current_user AS "user",inet_server_addr()::text AS "serverAddress",inet_server_port() AS "serverPort"');const stream=(client as any).connection.stream;
  if(fact.rows.length!==1)throw new Error('READONLY_QUERY_PEER');verifyMigrationPeer(source,{...fact.rows[0],remoteAddress:stream.remoteAddress,remotePort:stream.remotePort,encrypted:stream.encrypted===true,authorized:stream.authorized===true,localAddress:stream.localAddress},{sourceEvidence:evidence,approvedRdsTlsException:plan.approvedRdsTlsException});
  await verifyDiagnosticReadonlyRole(client,source.user);
  const value=await collectReadonlyLedger(client,source,plan.querySha256);
  const output='WSX_CN_MIGRATION_SNAPSHOT_V2='+gzipSync(JSON.stringify(value)).toString('base64')+'\n';if(Buffer.byteLength(output)>24*1024)throw new Error('READONLY_QUERY_OUTPUT_LIMIT');process.stdout.write(output);
 }finally{await client.end();}
}
if(process.argv[1]?.endsWith('cn-migration-snapshot-query.cjs'))main(process.argv.slice(2)).catch(()=>{process.stderr.write('CN_MIGRATION_READONLY_QUERY_REJECTED\n');process.exitCode=1;});
