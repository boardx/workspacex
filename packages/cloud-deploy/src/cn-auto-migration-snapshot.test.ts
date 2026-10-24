/** Unit stand-ins only: these do not establish live RDS, RAM-role or SQL access. */
import {it,expect} from 'vitest';
import {binding as fixture} from '../test/cn-migration-snapshot.fixture';
import {DIRECT_QUERY_SCRIPT,DIRECT_LEDGER_SQL,validateDirectHostMigrationSnapshot,runHostReadonlyQuery} from './cn-auto-migration-snapshot';
import {identityHash} from './cn-migration-source-identity';
import {migrationLedgerDigest,validateMigrationSnapshot} from './cn-migration-snapshot';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {mkdtempSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
function sample(){
 const source=structuredClone(fixture.source),sourceEvidence=structuredClone(fixture.sourceEvidence);
 const binding={schemaVersion:3,transport:'root-docker-host-readonly-v1',source,sourceEvidence,providerRawSha256:{GetCallerIdentity:'a'.repeat(64),DescribeDBInstanceAttribute:'b'.repeat(64),DescribeDBInstanceNetInfo:'c'.repeat(64)},auditRawSha256:'d'.repeat(64),querySha256:identityHash(DIRECT_QUERY_SCRIPT),containerId:'d'.repeat(64),sourceImageId:'sha256:'+'e'.repeat(64),sourceRevision:'a'.repeat(40),baselineSourceRevision:'b'.repeat(40),attemptId:'gha-10-1'};
 const audit={schemaVersion:1,readOnly:true,configurationSha256:source.configurationSha256,configuredRegionId:source.regionId,configuredRdsInstanceId:source.dbInstanceId,endpointSha256:source.endpointSha256,database:source.database,user:source.user,serverAddressSha256:source.serverAddressSha256,port:source.port,clientPeerAddressSha256:source.clientPeerAddressSha256,clientPeerPort:source.clientPeerPort,sslMode:source.sslMode,clientEncrypted:source.clientEncrypted,clientTlsAuthorized:source.clientTlsAuthorized};
 const ledger=[{name:'0001.sql',checksum:'c'.repeat(64)}];
 const output={schemaVersion:3,kind:'cn-direct-host-readonly-output',mode:'ledger',configuration:{host:sourceEvidence.configuration.host,port:source.clientPeerPort,database:source.database,user:source.user,sslMode:source.sslMode},audit,readOnly:true,transactionIsolation:'repeatable read',ledger,independentSqlCount:1,ledgerSha256:migrationLedgerDigest(ledger)};
 return {binding,output,validate:()=>validateDirectHostMigrationSnapshot(Buffer.from(JSON.stringify(output)),binding,'2026-10-24T00:00:00.000Z')};
}
it('validates explicit direct-host evidence without manufacturing a Cloud Assistant response',()=>{const s=sample();expect(s.validate().ledger).toEqual(s.output.ledger);expect(()=>validateMigrationSnapshot(s.output,s.binding)).toThrow();});
it('rejects truncated ledger even when its subset hash is correct',()=>{const s=sample();s.output.independentSqlCount=415;expect(s.validate).toThrow();});
it('rejects duplicate names and changed checksums',()=>{const s=sample();s.output.ledger.push({...s.output.ledger[0]!});s.output.independentSqlCount=2;s.output.ledgerSha256=migrationLedgerDigest(s.output.ledger);expect(s.validate).toThrow();const t=sample();t.output.ledger[0]!.checksum='e'.repeat(64);expect(t.validate).toThrow();});
it.each(['user','database','clientPeerAddressSha256','configurationSha256'])('rejects second-connection drift in %s',key=>{const s=sample();Object.assign(s.output.audit,{[key]:'f'.repeat(64)});expect(s.validate).toThrow();});
it('requires fixed query, direct transport and readonly repeatable transaction',()=>{for(const change of ['query','transport','readonly','isolation']){const s=sample();if(change==='query')s.binding.querySha256='f'.repeat(64);if(change==='transport')s.binding.transport='cloud-assistant-v2';if(change==='readonly')s.output.readOnly=false;if(change==='isolation')s.output.transactionIsolation='read committed';expect(s.validate).toThrow();}});
it('query rolls back, counts independently and never prints credentials',()=>{expect(DIRECT_LEDGER_SQL[0]).toContain('READ ONLY');expect(DIRECT_QUERY_SCRIPT).toContain("finally{await c.query('ROLLBACK')}");expect(DIRECT_QUERY_SCRIPT).toContain('SELECT count(*)::integer AS count FROM _kernel_migrations');expect(DIRECT_QUERY_SCRIPT).not.toContain('JSON.stringify(e)');expect(DIRECT_QUERY_SCRIPT).not.toMatch(/GRANT |ALTER ROLE|INSERT INTO/);});
it('actual CLI refuses invalid identity before host operations and never silently succeeds',()=>{
 const r=spawnSync(process.execPath,['--import','tsx',fileURLToPath(new URL('./cn-auto-migration-snapshot.ts',import.meta.url)),'main','gha-1-1','b'.repeat(40)],{encoding:'utf8',timeout:15000});
 expect(r.status).toBe(3);expect(r.stdout).toBe('');expect(r.stderr).toBe('CN_AUTO_MIGRATION_SNAPSHOT_REJECTED\n');
});
const client={imageId:'sha256:'+'e'.repeat(64),owner:'f'.repeat(32),name:'wsx-migration-audit-test',envFile:'/private/database.env',mode:'audit' as const,meta:{allowedCidrs:['192.168.100.40/32']}};
it('fixed host client pins source image and resources without bridge fallback or secret argv',async()=>{
 const calls:string[][]=[];await runHostReadonlyQuery(client,(_file,args)=>{calls.push(args);return Buffer.from(args.includes('run')?'{}':'');});
 const args=calls[0]!;for(const fixed of ['--network=host','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=128m','--cpus=1','--pids-limit=32',client.imageId,'--env-file'])expect(args).toContain(fixed);
 expect(args).not.toContain('exec');expect(args).not.toContain('APP_DB_PASSWORD=');
});
it('joins Docker daemon container after command timeout and proves removal',async()=>{
 const calls:string[][]=[];let removed=false;
 await expect(runHostReadonlyQuery(client,(_file,args)=>{calls.push(args);if(args.includes('run'))throw Error('timeout');if(args.includes('ps'))return Buffer.from(removed?'':'a'.repeat(64));if(args.includes('inspect'))return Buffer.from(JSON.stringify([{Name:'/'+client.name,Image:client.imageId,Config:{Labels:{'wsx.migration.owner':client.owner}},HostConfig:{NetworkMode:'host'}}]));if(args.includes('rm')){removed=true;return Buffer.from('');}throw Error();})).rejects.toThrow('timeout');
 expect(removed).toBe(true);expect(calls.filter(c=>c.includes('ps'))).toHaveLength(2);
});
it('refuses mutable source images, legacy bridge transport and foreign cleanup ownership',async()=>{
 await expect(runHostReadonlyQuery({...client,imageId:'repo:latest'},()=>Buffer.from(''))).rejects.toThrow();
 const s=sample();s.binding.transport='root-docker-exec-readonly-v1';expect(s.validate).toThrow();
 let removed=false;await expect(runHostReadonlyQuery(client,(_file,args)=>{if(args.includes('run'))throw Error();if(args.includes('ps'))return Buffer.from('a'.repeat(64));if(args.includes('inspect'))return Buffer.from(JSON.stringify([{Name:'/'+client.name,Image:client.imageId,Config:{Labels:{'wsx.migration.owner':'foreign'}},HostConfig:{NetworkMode:'host'}}]));if(args.includes('rm'))removed=true;return Buffer.from('');})).rejects.toThrow();expect(removed).toBe(false);
});
it.each(['SIGTERM','SIGINT','SIGHUP'] as const)('actual %s joins client then cleans daemon stand-in and private environment',async signal=>{
 const root=mkdtempSync(join(tmpdir(),'migration-signal-')),ready=join(root,'ready'),result=join(root,'result');
 // Real OS parent/child signals; the Docker daemon port alone is a stand-in.
 const moduleUrl=new URL('./cn-auto-migration-snapshot.ts',import.meta.url).href;
 const script=`import {executeHostQueryCommand,runHostReadonlyQuery,withHostQueryCancellation} from ${JSON.stringify(moduleUrl)};
import fs from 'node:fs';const root=${JSON.stringify(root)},ready=${JSON.stringify(ready)},result=${JSON.stringify(result)};
const env=root+'/private';fs.mkdirSync(env,{mode:0o700});fs.writeFileSync(env+'/db.env','APP_DB_PASSWORD=synthetic-test-only',{mode:0o600});
const input=${JSON.stringify(client)};let removed=false;
try{await withHostQueryCancellation(async abort=>{try{await runHostReadonlyQuery(input,async(file,args)=>{
if(args.includes('run'))return executeHostQueryCommand(process.execPath,['-e',"require('fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)",ready],abort);
if(args.includes('ps'))return Buffer.from(removed?'':'a'.repeat(64));
if(args.includes('inspect'))return Buffer.from(JSON.stringify([{Name:'/'+input.name,Image:input.imageId,Config:{Labels:{'wsx.migration.owner':input.owner}},HostConfig:{NetworkMode:'host'}}]));
if(args.includes('rm')){removed=true;return Buffer.from('');}throw Error();});}finally{fs.rmSync(env,{recursive:true,force:true});}});}catch{process.exitCode=3;}finally{fs.writeFileSync(result,JSON.stringify({removed,privateGone:!fs.existsSync(env)}));}`;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{stdio:['ignore','ignore','pipe']});
 const completion=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 try{
  const deadline=Date.now()+10000;while(!existsSync(ready)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,15));
  expect(existsSync(ready)).toBe(true);const pid=Number(readFileSync(ready,'utf8'));child.kill(signal);
  const status=await Promise.race([completion,new Promise<never>((_,reject)=>{const t=setTimeout(()=>reject(Error('cancellation cleanup timeout')),10000);t.unref();})]);
  expect(status).toBe(3);expect(JSON.parse(readFileSync(result,'utf8'))).toEqual({removed:true,privateGone:true});
  expect(()=>process.kill(pid,0)).toThrow();
 }finally{if(child.exitCode===null)child.kill('SIGKILL');rmSync(root,{recursive:true,force:true});}
},25000);
