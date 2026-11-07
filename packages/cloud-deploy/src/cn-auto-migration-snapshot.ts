/** Direct host evidence, distinct from Cloud Assistant v2. No SQL mutation or grants. */
import {execFileSync,spawn} from 'node:child_process';
import {constants,openSync,readFileSync,fstatSync,closeSync,lstatSync,mkdirSync,mkdtempSync,writeFileSync,fsyncSync,rmSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {deploymentConfigSchema} from './config';
import {DatabaseSecret} from './data-secrets';
import {deriveMigrationSourceIdentity,identityHash,migrationSourceSchema,sourceEvidenceSchema,verifyExternalSourceIdentity} from './cn-migration-source-identity';
import {generateMigrationPlan} from './cn-migration-plan';
import {migrationLedgerDigest} from './cn-migration-snapshot';
const fail=():never=>{throw Error('CN_AUTO_MIGRATION_SNAPSHOT_REJECTED');};
const sha=z.string().regex(/^[a-f0-9]{40}$/),hash=z.string().regex(/^[a-f0-9]{64}$/);
const canonical=(v:unknown):string=>JSON.stringify(v);
export const DIRECT_LEDGER_SQL=['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
 'SELECT name,checksum FROM _kernel_migrations ORDER BY name','SELECT count(*)::integer AS count FROM _kernel_migrations','ROLLBACK'] as const;
/** Executed in a fixed baseline-image host-network readonly client. */
export const DIRECT_QUERY_SCRIPT=String.raw`
const {Client}=require('pg'),fs=require('fs'),crypto=require('crypto');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const mode=process.argv[1],meta=JSON.parse(process.argv[2]);
const e=process.env,port=Number(e.PGPORT||5432),sslMode=e.PGSSLMODE;
if(!['disable','verify-full'].includes(sslMode)||!e.APP_DB_USER||!e.APP_DB_PASSWORD)process.exit(2);
const c=new Client({host:e.PGHOST,port,database:e.PGDATABASE||'workspacex',user:e.APP_DB_USER,password:e.APP_DB_PASSWORD,ssl:sslMode==='disable'?false:{rejectUnauthorized:true,ca:fs.readFileSync(e.PGSSLROOTCERT,'utf8')},connectionTimeoutMillis:10000,statement_timeout:20000});
(async()=>{await c.connect();try{await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');try{
if(sslMode==='disable'){
 const ip=v=>{const p=v.replace(/^::ffff:/,'').split('.');if(p.length!==4||p.some(n=>!/^\d+$/.test(n)||Number(n)>255))throw Error();return p.reduce((a,n)=>(a*256+Number(n))>>>0,0)};
 const local=ip(c.connection.stream.localAddress);
 if(!Array.isArray(meta.allowedCidrs)||!meta.allowedCidrs.some(cidr=>{const [base,bits]=cidr.split('/'),n=Number(bits);if(n<1||n>32)return false;const mask=(0xffffffff<<(32-n))>>>0;return (local&mask)===(ip(base)&mask)}))throw Error();
}
const ro=(await c.query('SHOW transaction_read_only')).rows[0].transaction_read_only;
const isolation=(await c.query('SHOW transaction_isolation')).rows[0].transaction_isolation;
if(ro!=='on'||isolation!=='repeatable read')throw Error();
const r=(await c.query('SELECT current_database() AS database,current_user AS "user",inet_server_addr()::text AS address,inet_server_port() AS port')).rows[0],s=c.connection.stream;
const audit={schemaVersion:1,readOnly:true,configurationSha256:meta.configurationSha256,configuredRegionId:meta.region,configuredRdsInstanceId:meta.instance,endpointSha256:hash(e.PGHOST+':'+port),database:r.database,user:r.user,serverAddressSha256:r.address?hash(r.address):null,port:r.port,clientPeerAddressSha256:hash(s.remoteAddress),clientPeerPort:s.remotePort,sslMode,clientEncrypted:s.encrypted===true,clientTlsAuthorized:s.authorized===true};
let ledger,independentSqlCount;
if(mode==='ledger'){ledger=(await c.query('SELECT name,checksum FROM _kernel_migrations ORDER BY name')).rows;const n=(await c.query('SELECT count(*)::integer AS count FROM _kernel_migrations')).rows;if(n.length!==1||n[0].count!==ledger.length)throw Error();independentSqlCount=n[0].count;}
process.stdout.write(JSON.stringify({schemaVersion:3,kind:'cn-direct-host-readonly-output',mode,configuration:{host:e.PGHOST,port,database:r.database,user:r.user,sslMode},audit,readOnly:true,transactionIsolation:isolation,...(mode==='ledger'?{ledger,independentSqlCount,ledgerSha256:hash(JSON.stringify(ledger))}:{})}));
}finally{await c.query('ROLLBACK')}}finally{await c.end()}})().catch(()=>{process.stderr.write('CN_DIRECT_LEDGER_READ_REJECTED\n');process.exitCode=2});`;
const rows=z.array(z.object({name:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\.sql$/),checksum:hash}).strict()).max(100000);
const bindingSchema=z.object({schemaVersion:z.literal(3),transport:z.literal('root-docker-host-readonly-v1'),source:migrationSourceSchema,sourceEvidence:sourceEvidenceSchema,providerRawSha256:z.object({GetCallerIdentity:hash,DescribeDBInstanceAttribute:hash,DescribeDBInstanceNetInfo:hash}).strict(),auditRawSha256:hash,querySha256:hash,containerId:z.string().regex(/^[a-f0-9]{64}$/),sourceImageId:z.string().regex(/^sha256:[a-f0-9]{64}$/),sourceRevision:sha,baselineSourceRevision:sha,attemptId:z.string().regex(/^gha-[0-9]+-[0-9]+$/)}).strict();
export function validateDirectHostMigrationSnapshot(raw:Buffer,bindingInput:unknown,capturedAt:string){
 const binding=bindingSchema.parse(bindingInput);
 if(binding.querySha256!==identityHash(DIRECT_QUERY_SCRIPT)||!verifyExternalSourceIdentity(binding.source,binding.sourceEvidence)||raw.length>8*1024*1024)fail();
 const out=JSON.parse(raw.toString('utf8'));
 if(out.schemaVersion!==3||out.kind!=='cn-direct-host-readonly-output'||out.mode!=='ledger'||out.readOnly!==true||out.transactionIsolation!=='repeatable read')fail();
 const actual=deriveMigrationSourceIdentity(binding.sourceEvidence,out.audit,binding.source.identityLane);
 if(canonical(actual.source)!==canonical(binding.source)||['host','port','database','user','sslMode'].some(key=>out.configuration?.[key]!==binding.sourceEvidence.configuration[key as keyof typeof binding.sourceEvidence.configuration]))fail();
 const ledger=rows.parse(out.ledger);
 if(!Number.isSafeInteger(out.independentSqlCount)||out.independentSqlCount!==ledger.length||new Set(ledger.map(r=>r.name)).size!==ledger.length||migrationLedgerDigest(ledger)!==out.ledgerSha256||!z.string().datetime().safeParse(capturedAt).success)fail();
 return {ledger,independentSqlCount:out.independentSqlCount as number,ledgerSha256:out.ledgerSha256 as string,sourceBindingSha256:identityHash(canonical(binding)),snapshotSha256:identityHash(canonical({schemaVersion:3,transport:binding.transport,capturedAt,rawSha256:identityHash(raw.toString('utf8'))})),fullResponseSha256:identityHash(raw.toString('utf8')),capturedAt};
}
function privateBytes(path:string,certificate=false){
 for(let p=dirname(path);;p=dirname(p)){const s=lstatSync(p);if(!s.isDirectory()||s.uid!==0||(s.mode&0o022))fail();if(p==='/')break;}
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{
 const s=fstatSync(fd);if(!s.isFile()||s.uid!==0||s.gid!==0||!(certificate?[0o600,0o644]:[0o600]).includes(s.mode&0o777)||s.nlink!==1||s.size>8*1024*1024)fail();
 const bytes=readFileSync(fd),end=fstatSync(fd),named=lstatSync(path);
 if(bytes.length!==s.size||bytes.length>8*1024*1024||['dev','ino','size','mtimeMs','ctimeMs'].some(k=>s[k as keyof typeof s]!==end[k as keyof typeof end])||named.dev!==s.dev||named.ino!==s.ino||!named.isFile()||named.nlink!==1)fail();return bytes;
 }finally{closeSync(fd);}
}
function install(path:string,bytes:Buffer){const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}const parent=openSync(dirname(path),constants.O_RDONLY);try{fsyncSync(parent);}finally{closeSync(parent);}}
export interface AutoMigrationPlanOptions{sourceRevision:string;baselineSourceRevision:string;attemptId:string;checkout:string}
type HostRun=(file:string,args:string[])=>Buffer|Promise<Buffer>;
/** Join the actual client before invoking daemon cleanup. No raw child errors
 * or stderr escape, including on external cancellation and output overflow. */
export function executeHostQueryCommand(file:string,args:string[],signal?:AbortSignal):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(Error('CN_DIRECT_QUERY_CANCELLED'));return;}
  const child=spawn(file,args,{stdio:['ignore','pipe','ignore'],detached:true,env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/nonexistent',LANG:'C.UTF-8'}});
  const chunks:Buffer[]=[];let length=0,invalid=false;
  const stop=()=>{invalid=true;if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{}};
  const timer=setTimeout(stop,45000);
  signal?.addEventListener('abort',stop,{once:true});
  const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);};
  child.stdout!.on('data',(bytes:Buffer)=>{length+=bytes.length;if(length>8*1024*1024)stop();else chunks.push(bytes);});
  child.once('error',()=>{finish();reject(Error('CN_DIRECT_QUERY_PROCESS_FAILED'));});
  child.once('close',code=>{finish();if(code!==0||invalid)reject(Error('CN_DIRECT_QUERY_PROCESS_FAILED'));else resolve(Buffer.concat(chunks));});
 });
}
/** Repeated cancellation cannot interrupt the protected cleanup phase. */
export async function withHostQueryCancellation<T>(operation:(signal:AbortSignal)=>Promise<T>):Promise<T>{
 const controller=new AbortController(),cancel=()=>controller.abort();
 const signals=['SIGTERM','SIGINT','SIGHUP'] as const;
 for(const signal of signals)process.on(signal,cancel);
 try{const value=await operation(controller.signal);if(controller.signal.aborted)fail();return value;}
 finally{for(const signal of signals)process.removeListener(signal,cancel);}
}
/** Fixed host namespace, never an automatic bridge fallback. Cleanup also runs
 * when docker run times out or exceeds its captured-output budget. */
export async function runHostReadonlyQuery(input:{imageId:string;owner:string;name:string;envFile:string;caFile?:string;mode:'audit'|'ledger';meta:unknown},run:HostRun){
 if(!/^sha256:[a-f0-9]{64}$/.test(input.imageId)||!/^wsx-migration-[a-z0-9-]{1,100}$/.test(input.name)||!/^[a-f0-9]{32}$/.test(input.owner))fail();
 const docker=(...args:string[])=>run('/usr/bin/docker',['--host','unix:///var/run/docker.sock',...args]);
 try{return await docker('run','--rm','--pull=never','--network=host','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=128m','--cpus=1','--pids-limit=32','--name',input.name,'--label',`wsx.migration.owner=${input.owner}`,'--env-file',input.envFile,...(input.caFile?['--mount',`type=bind,src=${input.caFile},dst=/run/wsx-migration-ca.pem,readonly`]:[]),'--entrypoint','node',input.imageId,'-e',DIRECT_QUERY_SCRIPT,input.mode,JSON.stringify(input.meta));}
 finally{
  const ids=(await docker('ps','-aq','--filter',`label=wsx.migration.owner=${input.owner}`)).toString('utf8').trim().split(/\s+/).filter(Boolean);
  if(ids.length>1)fail();
  for(const id of ids){
   if(!/^[a-f0-9]{12,64}$/.test(id))fail();
   const v=JSON.parse((await docker('inspect',id)).toString('utf8'));if(v.length!==1||v[0].Name!==`/${input.name}`||v[0].Image!==input.imageId||v[0].Config.Labels?.['wsx.migration.owner']!==input.owner||v[0].HostConfig.NetworkMode!=='host')fail();
   await docker('rm','-f',id);
  }
  if((await docker('ps','-aq','--filter',`label=wsx.migration.owner=${input.owner}`)).toString('utf8').trim())fail();
 }
}
/** Root fixed host adapter; caller holds the canonical release lock throughout.
 * Errors never include provider stderr or SQL/credential bytes. */
export async function produceAutoMigrationPlan(options:AutoMigrationPlanOptions){
 try{
 if(process.getuid?.()!==0||process.platform!=='linux')fail();
 const source=sha.parse(options.sourceRevision),baseline=sha.parse(options.baselineSourceRevision),attempt=z.string().regex(/^gha-[0-9]+-[0-9]+$/).parse(options.attemptId);
 const configRaw=privateBytes(`/etc/workspacex-cn/candidate-configs/${source}/${attempt}/deployment.json`),config=deploymentConfigSchema.parse(JSON.parse(configRaw.toString('utf8')));
 const env=config.environment;if(env.profile!=='production')throw Error('PRODUCTION_CONFIGURATION_REQUIRED');
 if(!env.databaseSecretRef.startsWith('file:/'))fail();
 const databaseRaw=privateBytes(env.databaseSecretRef.slice(5)),database=DatabaseSecret.parse(JSON.parse(databaseRaw.toString('utf8')));
 const expectedConfiguration={host:database.host,port:database.port,database:database.database,user:database.user,sslMode:env.rdsTlsException?'disable':'verify-full'};
 const publish=privateBytes('/etc/workspacex-cn/publish.env').toString('utf8');
 const role=publish.match(/^(?:export[ \t]+)?WSX_ECS_RAM_ROLE_NAME=(?:"([A-Za-z0-9_-]+)"|'([A-Za-z0-9_-]+)'|([A-Za-z0-9_-]+))\r?$/m)?.slice(1).find(Boolean);if(!role)fail();
 const run=(file:string,args:string[])=>execFileSync(file,args,{encoding:'buffer',timeout:45000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/nonexistent',LANG:'C.UTF-8'}});
 const providerRaw:Record<string,Buffer>={};
 const cloud=(service:string,action:string,args:string[]=[])=>{const bytes=run('/usr/local/bin/aliyun',[service,action,'--region',env.regionId,'--mode','EcsRamRole','--ram-role-name',role!,...args]);providerRaw[action+'.raw.json']=bytes;return JSON.parse(bytes.toString('utf8'));};
 const stsResponse=cloud('sts','GetCallerIdentity'),attributeResponse=cloud('rds','DescribeDBInstanceAttribute',['--DBInstanceId',env.rdsInstanceId]),netInfoResponse=cloud('rds','DescribeDBInstanceNetInfo',['--DBInstanceId',env.rdsInstanceId]);
 const inspect=JSON.parse(run('/usr/bin/docker',['--host','unix:///var/run/docker.sock','inspect','workspacex-cn-api-1']).toString('utf8'));
 if(inspect.length!==1||inspect[0].State.Running!==true||inspect[0].Config.Labels?.['org.opencontainers.image.revision']!==baseline)fail();
 const containerId=z.string().regex(/^[a-f0-9]{64}$/).parse(inspect[0].Id);
 const sourceImageId=z.string().regex(/^sha256:[a-f0-9]{64}$/).parse(inspect[0].Image);
 const image=JSON.parse(run('/usr/bin/docker',['--host','unix:///var/run/docker.sock','image','inspect',sourceImageId]).toString('utf8'));
 if(image.length!==1||image[0].Id!==sourceImageId||image[0].Config.Labels?.['org.opencontainers.image.revision']!==baseline)fail();
 const meta={configurationSha256:identityHash(canonical({deploymentSha256:identityHash(configRaw.toString('utf8')),databaseSecretSha256:identityHash(databaseRaw.toString('utf8'))})),region:env.regionId,instance:env.rdsInstanceId,allowedCidrs:env.rdsTlsException?.allowedCidrs??[]};
 const {auditRaw,ledgerRaw}=await withHostQueryCancellation(async signal=>{
 const directoryTemp=mkdtempSync('/var/lib/workspacex-cn/runtime/.migration-query-');chmodSync(directoryTemp,0o700);
 try{
  const envFile=directoryTemp+'/database.env';
  const values={PGHOST:database.host,PGPORT:String(database.port),PGDATABASE:database.database,APP_DB_USER:database.user,APP_DB_PASSWORD:database.password,PGSSLMODE:expectedConfiguration.sslMode,...(expectedConfiguration.sslMode==='verify-full'?{PGSSLROOTCERT:'/run/wsx-migration-ca.pem'}:{})};
  writeFileSync(envFile,Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
  let caFile:string|undefined;
  if(expectedConfiguration.sslMode==='verify-full'){const certificatePath=database.caFile;if(!certificatePath)throw Error('CANONICAL_CA_REQUIRED');caFile=directoryTemp+'/ca.pem';writeFileSync(caFile,privateBytes(certificatePath,true),{mode:0o644,flag:'wx'});}
  const query=(mode:'audit'|'ledger')=>{if(signal.aborted)fail();const owner=randomBytes(16).toString('hex');return runHostReadonlyQuery({imageId:sourceImageId,owner,name:`wsx-migration-${mode}-${owner}`,envFile,caFile,mode,meta},(file,args)=>executeHostQueryCommand(file,args,args.includes('run')?signal:undefined));};
  return {auditRaw:await query('audit'),ledgerRaw:await query('ledger')};
 }finally{rmSync(directoryTemp,{recursive:true,force:true});}
 });
 const audit=JSON.parse(auditRaw.toString('utf8'));
 if(audit.schemaVersion!==3||audit.mode!=='audit'||audit.readOnly!==true||audit.transactionIsolation!=='repeatable read')fail();
 if(Object.entries(expectedConfiguration).some(([key,value])=>audit.configuration?.[key]!==value))fail();
 const sourceEvidence={request:{regionId:env.regionId,dbInstanceId:env.rdsInstanceId},configuration:{...expectedConfiguration,sha256:meta.configurationSha256,endpointSha256:identityHash(`${database.host}:${database.port}`),regionId:env.regionId,rdsInstanceId:env.rdsInstanceId,...(env.rdsTlsException?{rdsTlsException:env.rdsTlsException}:{})},stsResponse,attributeResponse,netInfoResponse};
 const derived=deriveMigrationSourceIdentity(sourceEvidence,audit.audit,audit.audit.serverAddressSha256===null?'aliyun-private-endpoint':'sql-server-address');
 const providerRawSha256=Object.fromEntries(Object.entries(providerRaw).map(([name,bytes])=>[name.replace('.raw.json',''),identityHash(bytes.toString('utf8'))]));
 const binding=bindingSchema.parse({schemaVersion:3,transport:'root-docker-host-readonly-v1',...derived,providerRawSha256,auditRawSha256:identityHash(auditRaw.toString('utf8')),querySha256:identityHash(DIRECT_QUERY_SCRIPT),containerId,sourceImageId,sourceRevision:source,baselineSourceRevision:baseline,attemptId:attempt});
 const capturedAt=new Date().toISOString(),snapshot=validateDirectHostMigrationSnapshot(ledgerRaw,binding,capturedAt);
 const {ledger,...snapshotEvidence}=snapshot;
 const plan=await generateMigrationPlan(options.checkout,{targetSha:source,baselineSha:baseline,ledger,snapshotEvidence});
 const root='/etc/workspacex-cn/migration-plans';for(const p of [root,`${root}/${source}`,`${root}/${source}/${attempt}`]){try{mkdirSync(p,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}const s=lstatSync(p);if(!s.isDirectory()||s.uid!==0||(s.mode&0o777)!==0o700)fail();}
 const directory=`${root}/${source}/${attempt}`;
 const providerIndex=Object.fromEntries(Object.entries(providerRaw).map(([name,bytes])=>[name,identityHash(bytes.toString('utf8'))]));
 for(const [name,bytes] of Object.entries({...providerRaw,'provider-raw-index.json':Buffer.from(canonical(providerIndex)),'audit.raw.json':auditRaw,'ledger.raw.json':ledgerRaw,'provider.json':Buffer.from(canonical(sourceEvidence)),'source-binding.json':Buffer.from(canonical(binding)),'snapshot-envelope.json':Buffer.from(canonical({schemaVersion:3,transport:binding.transport,capturedAt,rawSha256:identityHash(ledgerRaw.toString('utf8'))})),'snapshot.json':Buffer.from(canonical({...snapshot,schemaVersion:3,transport:binding.transport})),'plan.json':Buffer.from(canonical(plan))}))install(`${directory}/${name}`,bytes);
 return {path:`${directory}/plan.json`,sha256:identityHash(canonical(plan)),planSha256:plan.planSha256,ready:plan.ready,blockers:plan.blockers,sourceBindingSha256:snapshot.sourceBindingSha256};
 }catch{throw Error('CN_AUTO_MIGRATION_SNAPSHOT_REJECTED');}
}

/** Fixed CLI for the existing build entrypoint; inherited FD9 must own release.lock. */
export async function autoMigrationSnapshotMain(args:string[]){
 try{
 if(process.platform!=='linux'||process.getuid?.()!==0||process.getgid?.()!==0||args.length!==3)fail();
 const sourceRevision=sha.parse(args[0]),attemptId=z.string().regex(/^gha-[0-9]+-[0-9]+$/).parse(args[1]),baselineSourceRevision=sha.parse(args[2]);
 const proof=String.raw`import os,stat,fcntl
p='/var/lib/workspacex-cn/runtime/release.lock'
assert os.readlink('/proc/self/fd/9')==p
a=os.fstat(9);fd=os.open(p,os.O_RDWR|os.O_NOFOLLOW)
try:
 b=os.fstat(fd)
 assert stat.S_ISREG(b.st_mode) and (b.st_uid,b.st_gid,stat.S_IMODE(b.st_mode),b.st_nlink)==(0,0,0o600,1)
 assert (a.st_dev,a.st_ino)==(b.st_dev,b.st_ino)
 try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:pass
 else:raise ValueError('release lock not held')
finally:os.close(fd)
`;
 execFileSync('/usr/bin/python3',['-I','-S','-c',proof],{timeout:10000,stdio:['ignore','pipe','pipe','ignore','ignore','ignore','ignore','ignore','ignore',9],env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent'}});
 const result=await produceAutoMigrationPlan({sourceRevision,attemptId,baselineSourceRevision,checkout:process.cwd()});
 process.stdout.write(JSON.stringify(result)+'\n');
 if(!result.ready)process.exitCode=3;
 }catch{process.stderr.write('CN_AUTO_MIGRATION_SNAPSHOT_REJECTED\n');process.exitCode=3;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)void autoMigrationSnapshotMain(process.argv.slice(2));
