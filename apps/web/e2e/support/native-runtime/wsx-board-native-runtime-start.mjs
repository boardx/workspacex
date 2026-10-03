import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeStartupFailure} from './native-startup-receipt.mjs';
import {nativeRuntimePorts,localRuntimePorts,nativeProviderEnvironment,assertNativePortsAvailable} from './native-runtime-ports.mjs';
import {createOwnedOneShots} from './native-owned-one-shot.mjs';
let phase='BOOTSTRAP',data,sourceHead=null,stopRuntime=async()=>{},cwdChildState=()=>null;
try{
const [planPath]=process.argv.slice(2);assert(planPath,'Private prepared plan required');
const plan=JSON.parse(readFileSync(planPath)),{root,head,data:runtimeData,bin,database,isolation,marker,ports}=plan;
phase='SOURCE';
const {assertTemporaryRuntimePaths,assertRuntimeSourceFiles}=await import('./runtime-attestation.mjs');
assert(plan.prepared&&!plan.ready);assertTemporaryRuntimePaths(root,runtimeData);data=runtimeData;
assert.match(database,/^wsx_r09_[a-f0-9]{32}$/);assert.match(marker,/^[a-f0-9-]{36}$/);
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),head);assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),'');
sourceHead=head;phase='IMPORT';
const require=createRequire(join(root,'package.json'));require('tsx/cjs/api').register();require('tsx/esm/api').register();const load=path=>import(pathToFileURL(join(root,path)).href);
const {verifyRuntimeManifest,runtimeSourceHashes,committedRuntimeSourceHashes,nativeAcceptanceOptions}=await import('./runtime-attestation.mjs');
const acceptanceOptions=nativeAcceptanceOptions(plan);
phase='SOURCE';
const sourceFiles=Object.keys(plan.sourceHashes);assertRuntimeSourceFiles(root,sourceFiles);assert.deepEqual(runtimeSourceHashes(root,sourceFiles),plan.sourceHashes);assert.deepEqual(plan.sourceHashes,committedRuntimeSourceHashes(root,head,sourceFiles));
phase='IMPORT';
const {resolveLocalConfig,apiEnv,webEnv,paths}=await load('packages/local-runtime/src/config.ts');
const {startManaged,killTree,waitForHttpOrExit}=await load('packages/local-runtime/src/processes.ts');
const {tsxLaunch,nextLaunch}=await load('packages/local-runtime/src/node-launch.ts');
phase='PREFLIGHT';
nativeRuntimePorts(ports);
if(plan.proxyWebSocketPort!==undefined)assert.equal(plan.proxyWebSocketPort,ports.proxyWebSocket,'proxy plan must derive from sole port map');
await assertNativePortsAvailable(ports);
const config=resolveLocalConfig({repoRoot:root,dataDir:data,ports:localRuntimePorts(ports)}),pgData=join(data,'native-pgdata');assert(!existsSync(pgData),'Fresh native database required');
const secrets=JSON.parse(readFileSync(join(data,'native-db-secrets.json')));for(const value of Object.values(secrets))assert.match(value,/^[A-Za-z0-9_-]{40,}$/);
const ownerPasswordFile=join(data,'owner-password.txt');writeFileSync(ownerPasswordFile,secrets.ownerPassword,{mode:0o600,flag:'wx'});
mkdirSync(join(data,'native-pg-socket'),{mode:0o700});mkdirSync(paths.logs(config),{recursive:true,mode:0o700});mkdirSync(paths.objects(config),{recursive:true,mode:0o700});
const startedAt=new Date().toISOString(),manifestPath=join(data,'runtime-manifest.json');
const manifest={webRoot:root,apiRoot:root,head,ports,sourceFiles,sourceHashes:plan.sourceHashes,webBase:`http://127.0.0.1:${ports.web}`,apiBase:`http://127.0.0.1:${ports.api}`,helperPid:process.pid,processes:[],ready:false,startedAt,nativeDatabase:{version:'16.15',vectorVersion:'0.8.6',name:database,port:ports.postgres},deploymentMarker:marker};
const save=()=>writeFileSync(manifestPath,JSON.stringify(manifest,null,2),{mode:0o600});save();
const children=[];let postgresRunning=false,stopping=false,stopPromise;
const oneShots=createOwnedOneShots({startManaged,killTree});
cwdChildState=service=>{const managed=children.find(item=>item.name===`native-board-${service}`);assert(managed,'Owned identity child required');return{childExitCode:managed.child.exitCode,childSignal:managed.child.signalCode};};
const nativeEnv={...process.env,...nativeProviderEnvironment(ports),PATH:`${bin}:${process.env.PATH??''}`,PGHOST:'127.0.0.1',PGPORT:String(ports.postgres),PGDATABASE:database,PGSSLMODE:'disable',APP_DB_USER:'app_rw',APP_DB_PASSWORD:secrets.appPassword,MIGRATION_DB_USER:'postgres',MIGRATION_DB_PASSWORD:secrets.ownerPassword,DIAG_DB_USER:'app_rw',DIAG_DB_PASSWORD:secrets.appPassword,WORKSPACEX_NATIVE_POSTGRES:'1',WORKSPACEX_DB:database,WORKSPACEX_ISOLATION_ID:isolation,WORKSPACEX_API_PORT:String(ports.api),WORKSPACEX_WEB_PORT:String(ports.web),COMPOSE_PROJECT_NAME:`unused-${isolation}`,BOARD_ACCEPTANCE_SHA:head,BOARD_ACCEPTANCE_RUNTIME_MARKER:marker,BOARD_ACCEPTANCE_RUNTIME_STARTED_AT:startedAt,WORKSPACEX_DEPLOYMENT_MARKER:marker,WORKSPACEX_EDITION:'cloud'};
const stop=()=>{if(stopPromise)return stopPromise;stopping=true;stopPromise=(async()=>{const failures=[];try{await oneShots.stop();}catch(error){failures.push(error);}for(const child of [...children].reverse())try{await child.stop();}catch(error){failures.push(error);}if(postgresRunning)try{execFileSync(join(bin,'pg_ctl'),['-D',pgData,'-m','fast','-w','stop'],{env:nativeEnv,stdio:'pipe'});postgresRunning=false;}catch(error){failures.push(error);}manifest.ready=false;try{save();}catch(error){failures.push(error);}if(failures.length)throw new AggregateError(failures,'Owned native runtime cleanup failed');})();return stopPromise;};
stopRuntime=stop;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void stop().then(()=>process.exit(0),()=>{console.error('OWNED_NATIVE_RUNTIME_STOP_FAILED');process.exit(1);}));
const run=async(name,launch,cwd,env)=>{assert(!stopping,'OWNED_ONE_SHOT_ADMISSION_CLOSED');writeFileSync(join(data,`${name}.log`),'',{mode:0o600,flag:'wx'});const managed=oneShots.start({name,command:launch.command,args:launch.args,cwd,logDir:data,env:{...env,...launch.env}});const code=await managed.completed();assert(!stopping,'OWNED_ONE_SHOT_CANCELLED');assert.equal(code,0,`${name} failed; inspect private log`);};
{
 phase='INITDB';
 execFileSync(join(bin,'initdb'),['-D',pgData,'-U','postgres','--pwfile',ownerPasswordFile,'--auth-host=scram-sha-256','--auth-local=scram-sha-256','--encoding=UTF8','--locale=C'],{env:nativeEnv,stdio:'pipe'});
 phase='POSTGRES';
 execFileSync(join(bin,'pg_ctl'),['-D',pgData,'-l',join(data,'native-postgres.log'),'-o',`-h 127.0.0.1 -p ${ports.postgres} -k ${join(data,'native-pg-socket')}`,'-w','start'],{env:nativeEnv,stdio:'pipe'});postgresRunning=true;
 phase='DATABASE';
 const {Client}=createRequire(join(root,'apps/api/package.json'))('pg');const ownerClient=new Client({host:'127.0.0.1',port:ports.postgres,database:'postgres',user:'postgres',password:secrets.ownerPassword});await ownerClient.connect();try{await ownerClient.query(`CREATE DATABASE ${database}`);}finally{await ownerClient.end();}
 phase='CONFIG';
 Object.assign(process.env,nativeEnv);const configuration=await load('apps/web/playwright.fullstack-smoke.config.ts');const fullstack=configuration.default?.default??configuration.default;assert(Array.isArray(fullstack.webServer));const officialApi=fullstack.webServer.find(server=>server.env?.PORT===String(ports.api)),officialWeb=fullstack.webServer.find(server=>server.env?.NEXT_DIST_DIR==='.next-fullstack-e2e');assert(officialApi&&officialWeb,'Official fullstack environments required');
 const apiEnvironment={...officialApi.env,...apiEnv(config),...nativeEnv},webEnvironment={...webEnv(config),...officialWeb.env,...nativeEnv,...(acceptanceOptions.webSocketUrl?{NEXT_PUBLIC_API_WS_URL:acceptanceOptions.webSocketUrl}:{})};
 if(acceptanceOptions.webSocketUrl)manifest.proxyWebSocketUrl=acceptanceOptions.webSocketUrl;
 phase='MIGRATE';
 await run('native-migrate',tsxLaunch(root,['src/infrastructure/db/migrate-cli.ts']),join(root,'apps/api'),apiEnvironment);
 phase='ROLE';
 const administrator=new Client({host:'127.0.0.1',port:ports.postgres,database,user:'postgres',password:secrets.ownerPassword});await administrator.connect();try{const version=await administrator.query("SELECT current_setting('server_version_num') AS server_version_num,version() AS server_version,(SELECT extversion FROM pg_extension WHERE extname='vector') AS vector_version");assert.equal(version.rows.length,1);assert.equal(version.rows[0].server_version_num,'160015');assert.match(version.rows[0].server_version,/PostgreSQL 16\.15/);assert.equal(version.rows[0].vector_version,'0.8.6');manifest.nativeDatabase.actualServer=version.rows[0];save();await administrator.query(`ALTER ROLE app_rw PASSWORD '${secrets.appPassword}'`);}finally{await administrator.end();}
 phase='SEED';
 await run('native-fullstack-seed',tsxLaunch(root,['scripts/seed-fullstack-smoke.ts']),join(root,'apps/api'),apiEnvironment);
 phase='ROLE';
 const application=new Client({host:'127.0.0.1',port:ports.postgres,database,user:'app_rw',password:secrets.appPassword});await application.connect();try{const proof=await application.query("SELECT current_user AS current_role,session_user AS authenticated_role,current_database() AS database,rolsuper,rolbypassrls,pg_has_role(current_user,'postgres','MEMBER') AS owner_membership FROM pg_roles WHERE rolname=current_user");assert.deepEqual(proof.rows,[{current_role:'app_rw',authenticated_role:'app_rw',database,rolsuper:false,rolbypassrls:false,owner_membership:false}]);manifest.nativeRoleProof=proof.rows[0];}finally{await application.end();}
 phase='BUILD';
 assert(!existsSync(join(root,'apps/web/.next-fullstack-e2e')),'Fresh production build directory required');await run('native-web-build',nextLaunch(root,['build']),join(root,'apps/web'),webEnvironment);
 phase='API';
 const apiLaunch=tsxLaunch(root,['src/main.ts']),actualApiEnvironment={...apiEnvironment,...apiLaunch.env},api=startManaged({name:'native-board-api',command:apiLaunch.command,args:apiLaunch.args,cwd:join(root,'apps/api'),logDir:paths.logs(config),env:actualApiEnvironment});children.push(api);manifest.processes.push({kind:'api',pid:api.child.pid,cwd:join(root,'apps/api'),entrypoint:join(root,'apps/api/src/main.ts')});save();await waitForHttpOrExit(`${manifest.apiBase}/healthz`,{timeoutMs:180000},api);
 phase='STORAGE';
 if(acceptanceOptions.storagePath){const storage=await load(acceptanceOptions.storagePath);manifest.fileStorage=storage.attestFileStorage({manifest,apiEnvironment:actualApiEnvironment,dataDir:data});save();storage.verifyFileStorage(manifest);}
 phase='WEB';
 const webLaunch=nextLaunch(root,['start','-p',String(ports.web),'-H','127.0.0.1']),web=startManaged({name:'native-board-web',command:webLaunch.command,args:webLaunch.args,cwd:join(root,'apps/web'),logDir:paths.logs(config),env:{...webEnvironment,...webLaunch.env}});children.push(web);manifest.processes.push({kind:'web',pid:web.child.pid,cwd:join(root,'apps/web'),entrypoint:'next start'});save();await waitForHttpOrExit(`${manifest.webBase}/login`,{timeoutMs:180000},web);
 phase='IDENTITY';
 verifyRuntimeManifest({manifestPath,root,base:manifest.webBase,origin:manifest.apiBase,sourceFiles});manifest.ready=true;save();writeFileSync(join(data,'native-runner-environment.json'),JSON.stringify(apiEnvironment),{mode:0o600,flag:'wx'});console.log(`NATIVE_BOARD_RUNTIME_READY ${manifestPath}`);
}
}catch(error){
 try{if(data){const context=error.identityCwd;const identityCwd=context?{...context,...cwdChildState(context.service)}:undefined;const listenerContext=error.identityListener;const identityListener=listenerContext?{...listenerContext,...cwdChildState(listenerContext.service)}:undefined;writeStartupFailure({data,phase,sourceHead,error,identityCwd,identityListener});}}catch{ /* Missing receipt is not a successful startup. */ }
 try{await stopRuntime();}catch(cleanupError){throw new AggregateError([error,cleanupError],'Native runtime startup and cleanup failed',{cause:error});}throw error;
}
