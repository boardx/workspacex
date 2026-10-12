/** Read-only admission to outer-owned isolated containers; no create/pull/down. */
import {lstatSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const stages=['environment','receipt-path','receipt-read','receipt-identity','postgres-inspect','redis-inspect','migration-config-import','migration-config','pg-import','pg-connect','pg-query','pg-readback','pg-close']as const;
let stage:typeof stages[number]='environment';
const safeCodes=new Set(["EXPLICIT_LOOPBACK_DATABASE_REQUIRED", "ISOLATED_DATABASE_REQUIRED", "PRIVATE_LINUX_INFRA_RECEIPT_REQUIRED", "INFRA_PARENT_UNTRUSTED", "INFRA_RECEIPT_UNTRUSTED", "INFRA_IDENTITY_MISMATCH", "IMMUTABLE_CONTAINER_REQUIRED", "INFRA_PORT_MISMATCH", "INFRA_INSPECT_SHAPE", "INFRA_LIVE_IDENTITY_CHANGED", "INFRA_LOOPBACK_COMMAND", "NO_PERSISTENT_MOUNTS", "MIGRATION_ENDPOINT_MISMATCH", "LIVE_DATABASE_READBACK_SHAPE", "LIVE_DATABASE_IDENTITY_OR_AGE_MISMATCH", "ENOENT", "EACCES", "ECONNREFUSED", "ETIMEDOUT", "28P01", "3D000", "ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED"]);
export function safeFailure(error:unknown,at:string){
 const e=error as {code?:unknown,message?:unknown};
 const code=typeof e?.message==='string'&&safeCodes.has(e.message)?e.message:typeof e?.code==='string'&&safeCodes.has(e.code)?e.code:'OTHER';
 return {kind:'cn-six-preflight-failure-v1',verified:false,stage:stages.includes(at as typeof stages[number])?at:'OTHER',code};
}
function need(v:unknown,code:string):asserts v{if(!v)throw Error(code);}
export function validateDatabaseEnvironment(env:NodeJS.ProcessEnv){
 need(env.PGHOST==='127.0.0.1'&&env.CN_RELEASE_FULLSTACK_FIXTURE==='1'&&env.WORKSPACEX_REUSE_INFRA!=='1','EXPLICIT_LOOPBACK_DATABASE_REQUIRED');
 need(/^wsx_[a-f0-9]{20}$/.test(env.PGDATABASE??'')&&env.PGDATABASE===env.WORKSPACEX_DB,'ISOLATED_DATABASE_REQUIRED');
}
export function postgresCommand(port:number){return ['postgres','-c','listen_addresses=127.0.0.1','-c','shared_preload_libraries=age','-p',String(port)];}
export function validatePostgresCommand(command:unknown,port:number){need(JSON.stringify(command)===JSON.stringify(postgresCommand(port)),'INFRA_LOOPBACK_COMMAND');}
// PostgreSQL text(inet) preserves /32; host(inet) returns the exact host address.
// https://www.postgresql.org/docs/current/functions-net.html (Table 9.40)
export const DATABASE_IDENTITY_SQL="SELECT current_database() AS database, host(inet_server_addr()) AS address, inet_server_port() AS port, current_setting('shared_preload_libraries') AS preload";
export function validateDatabaseReadback(row:any,database:string,port:number){
 need(row?.database===database&&row?.address==='127.0.0.1'&&Number(row?.port)===port&&row?.preload==='age','LIVE_DATABASE_IDENTITY_OR_AGE_MISMATCH');
}
export function boundedClientConfig(cfg:Record<string,unknown>){return {...cfg,connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:5000};}
export async function main(){
stage='environment';const env=process.env;
validateDatabaseEnvironment(env); // Before receipt reads, Docker inspection or any DB connection.
stage='receipt-path';const file=env.CN_SIX_INFRA_RECEIPT;
need(process.platform==='linux'&&process.getuid?.()===0&&file&&file.startsWith('/var/lib/')&&resolve(file)===file,'PRIVATE_LINUX_INFRA_RECEIPT_REQUIRED');
let parent=dirname(file);for(;;){const s=lstatSync(parent);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===0&&!(s.mode&0o022),'INFRA_PARENT_UNTRUSTED');if(parent==='/')break;parent=dirname(parent);}
const st=lstatSync(file);need(st.isFile()&&!st.isSymbolicLink()&&st.uid===0&&(st.mode&0o777)===0o600&&st.nlink===1&&st.size<=16384,'INFRA_RECEIPT_UNTRUSTED');
stage='receipt-read';const r=JSON.parse(readFileSync(file,'utf8'));
stage='receipt-identity';
need(r.kind==='cn-six-infra-v1'&&/^[0-9]+$/.test(r.runId)&&r.runId===env.GITHUB_RUN_ID&&r.roundId===env.CN_SIX_ROUND_ID&&/^[a-f0-9]{40}$/.test(r.sourceCommit)&&r.sourceCommit===env.CN_SIX_SOURCE_COMMIT&&/^wsx-six-[a-f0-9]{16}$/.test(r.project)&&/^[a-f0-9]{32}$/.test(r.ownerToken)&&r.project===env.COMPOSE_PROJECT_NAME&&r.dbName===env.WORKSPACEX_DB&&r.dbName===env.PGDATABASE&&/^wsx_[a-f0-9]{20}$/.test(r.dbName),'INFRA_IDENTITY_MISMATCH');
for(const role of ['postgres','redis']as const){
 const item=r[role];need(item&&/^[a-f0-9]{64}$/.test(item.containerId)&&/^sha256:[a-f0-9]{64}$/.test(item.imageId),'IMMUTABLE_CONTAINER_REQUIRED');
 need(Number.isInteger(item.port)&&item.port>0&&item.port<65536&&String(item.port)===env[role==='postgres'?'PGPORT':'REDIS_PORT'],'INFRA_PORT_MISMATCH');
 stage=role==='postgres'?'postgres-inspect':'redis-inspect';
 const values=JSON.parse(execFileSync('docker',['inspect',item.containerId],{encoding:'utf8',timeout:15000,maxBuffer:65536,stdio:['ignore','pipe','ignore']}));
 need(values.length===1,'INFRA_INSPECT_SHAPE');const v=values[0],labels=v.Config?.Labels;
 need(v.Id===item.containerId&&v.Image===item.imageId&&v.State?.Running===true&&labels?.['cn-six-fixture']===r.ownerToken&&labels?.['cn-six-project']===r.project&&labels?.['cn-six-role']===role,'INFRA_LIVE_IDENTITY_CHANGED');
 const command=role==='postgres'?postgresCommand(item.port):['redis-server','--bind','127.0.0.1','--port',String(item.port),'--save','','--appendonly','no'];
 need(v.Name==='/'+item.containerName&&v.HostConfig?.NetworkMode==='host'&&JSON.stringify(v.Config.Cmd)===JSON.stringify(command)&&JSON.stringify(item.command)===JSON.stringify(command),'INFRA_LOOPBACK_COMMAND');
 need(Array.isArray(v.Mounts)&&v.Mounts.every((x:{Type:string})=>x.Type==='tmpfs')&&Object.keys(v.HostConfig?.Binds??{}).length===0,'NO_PERSISTENT_MOUNTS');
}
stage='migration-config-import';const {migrationConfig}=await import('../../../apps/api/src/infrastructure/db/pg-config');
stage='migration-config';const cfg=migrationConfig();
need(cfg.host==='127.0.0.1'&&cfg.database===r.dbName&&cfg.port===r.postgres.port,'MIGRATION_ENDPOINT_MISMATCH');
stage='pg-import';const require=createRequire(new URL('../../../apps/api/package.json',import.meta.url));
const client=new (require('pg').Client)(boundedClientConfig({...cfg}));
try{
 stage='pg-connect';await client.connect();
 stage='pg-query';const result=await client.query(DATABASE_IDENTITY_SQL);
 need(result.rows.length===1,'LIVE_DATABASE_READBACK_SHAPE');
 stage='pg-readback';validateDatabaseReadback(result.rows[0],r.dbName,r.postgres.port);
}finally{await client.end();}
process.stdout.write(JSON.stringify({kind:'cn-six-infra-preflight-v1' ,verified:true,productionAccepted:false})+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(JSON.stringify(safeFailure(error,stage))+'\n');process.exitCode=1;});
