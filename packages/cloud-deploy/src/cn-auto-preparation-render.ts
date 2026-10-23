/** Canonical environment + compose renderer, restricted to attempt-owned local
 * resources. Production Compose files are never loaded, edited or mounted. */
import { X509Certificate,createPrivateKey,createHash } from 'node:crypto';
import { resolveSecret } from './secrets';
import { mkdir,readFile,writeFile,chown } from 'node:fs/promises';
import { deploymentConfigSchema } from './config';
import { validateReleaseManifest } from './release';
import { createCloudNginxConfig } from './nginx';
import { createCloudCompose } from './compose';
import { runtimeEnvironment,serializeRuntimeEnvironment } from './runtime-environment';
import { assertTrustedPath } from './trusted-path';
export async function renderAutoIsolated(request:any,policy:any,state:any,directory:string){
 const sha=request.identity.sourceRevision,attempt=request.identity.attemptId;
 if(directory!==`/var/lib/workspacex-cn/auto-preparation/${sha}/${attempt}/runtime`)throw new Error('ISOLATED_RUNTIME_PATH');
 const read=async(path:string)=>{await assertTrustedPath(path,{trustedRoot:'/',kind:'file',private:true});return JSON.parse(await readFile(path,'utf8'));};
 const config=deploymentConfigSchema.parse(await read(`/etc/workspacex-cn/candidate-configs/${sha}/${attempt}/deployment.json`));
 const manifestPath=directory.slice(0,-'/runtime'.length)+'/input-manifest.json';
 await assertTrustedPath(manifestPath,{trustedRoot:'/',kind:'file',private:true});
 const manifestBytes=await readFile(manifestPath);
 if(createHash('sha256').update(manifestBytes).digest('hex')!==request.dependencies.manifest)throw new Error('ISOLATED_MANIFEST_RAW_HASH');
 const manifest=validateReleaseManifest(JSON.parse(manifestBytes.toString('utf8')));
 if(manifest.sourceRevision!==sha||config.provision.release!==manifest.release)throw new Error('ISOLATED_MANIFEST');
 const maps=await runtimeEnvironment(config,policy.environment.stableSecretDirectory);
 const passwords=state.rolePasswords as Record<string,string>;
 const data={PGHOST:'postgres',PGPORT:'5432',PGDATABASE:'workspacex',PGSSLMODE:'disable',APP_DB_USER:'app_rw',APP_DB_PASSWORD:passwords.app_rw!,DIAG_DB_USER:'app_diag_ro',DIAG_DB_PASSWORD:passwords.app_diag_ro!,MIGRATION_DB_USER:'postgres',MIGRATION_DB_PASSWORD:state.password,REDIS_HOST:'redis',REDIS_PORT:'6379',REDIS_PASSWORD:state.redisPassword,REDIS_TLS:'false'};
 // Local FS is an explicit isolated shadow backend. Production OSS business
 // acceptance remains the later canonical activation gate.
 for(const map of [maps.api,maps.bootstrap,maps.migration]){
  for(const key of Object.keys(map))if(key.startsWith('OSS_')||key.startsWith('PG')||key.startsWith('APP_DB_')||key.startsWith('DIAG_DB_')||key.startsWith('MIGRATION_DB_')||key.startsWith('REDIS_')||key==='WORKSPACEX_RDS_TLS_EXCEPTION'||key==='WORKSPACEX_DEPLOY_PROFILE')delete map[key];
  Object.assign(map,data);
 }
 Object.assign(maps.api,{WORKSPACEX_OBJECT_STORE:'fs',WORKSPACEX_OBJECT_ROOT:'/run/isolated-files',APP_PUBLIC_URL:config.environment.publicUrl,WORKSPACEX_DEPLOYMENT_MARKER:state.marker});
 maps.migration.WORKSPACEX_DEPLOY_PROFILE='starter';
 maps.bootstrap.WORKSPACEX_DEPLOY_PROFILE='starter';
 maps.agent.DATABASE_URI=`postgresql://agent_server:${passwords.agent_server}@postgres:5432/workspacex_agent`;
 maps.agent.DEEP_AGENT_CHECKPOINT_DB=maps.agent.DATABASE_URI;
 maps.agent.MEMORY_STORE_DATABASE_URL=`postgresql://memory_rw:${passwords.memory_rw}@postgres:5432/workspacex_memory`;
 maps.agent.MEMORY_STORE_SCHEMA='workspacex_memory';maps.agent.REDIS_URI=`redis://:${state.redisPassword}@redis:6379/1`;
 for(const key of Object.keys(maps.agent))if(key.includes('CA_FILE')||key.includes('CA_CERT'))delete maps.agent[key];
 await mkdir(directory,{mode:0o700});
 for(const name of ['sandbox','sessions','certs','agent-certs','files']){await mkdir(`${directory}/${name}`,{mode:name==='certs'||name==='agent-certs'?0o755:0o700});if(['sandbox','sessions','files'].includes(name))await chown(`${directory}/${name}`,1000,1000);}
 for(const service of ['api','agent','web','bootstrap','migration'] as const)await writeFile(`${directory}/${service}.env`,serializeRuntimeEnvironment(maps[service]),{mode:0o600,flag:'wx'});
 const compose=createCloudCompose(config,manifest,{projectName:state.name,runtimeDirectory:directory}) as any;
 delete compose.services['sandbox-sessions'];
 // All binds are emitted anew by the canonical renderer inside this fresh tree.
 for(const [name,service] of Object.entries(compose.services) as [string,any][]){
  delete service.ports;service.restart='no';service.labels={'wsx.auto.owner':state.owner};
  const budgets:Record<string,[string,number]>={api:['768m',.4],web:['512m',.3],agent:['1536m',.5],sandbox:['256m',.1]};
  [service.mem_limit,service.cpus]=budgets[name]!;service.memswap_limit=service.mem_limit;
  if(name!=='sandbox')service.networks={default:{aliases:[name]}};
 }
 // Remove canonical cloud-only storage variables at their second source: the
 // explicit compose environment overrides env_file values.
 for(const key of Object.keys(compose.services.api.environment))if(key.startsWith('OSS_')||key.startsWith('WORKSPACEX_'))delete compose.services.api.environment[key];
 compose.services.api.environment.WORKSPACEX_OBJECT_STORE='fs';compose.services.api.environment.WORKSPACEX_OBJECT_ROOT='/run/isolated-files';
 compose.services.api.volumes.push({type:'bind',source:directory+'/files',target:'/run/isolated-files',bind:{create_host_path:false}});
 compose.networks={default:{external:true,name:state.name+'-net'}};
 for(const service of Object.values(compose.services) as any[])for(const mount of service.volumes??[])if(mount.type!=='bind'||!mount.source.startsWith(directory+'/'))throw new Error('ISOLATED_BIND_ESCAPE');
 if(!config.environment.tlsSecretRef.startsWith('file:'))throw new Error('ISOLATED_FILE_TLS_REFERENCE_REQUIRED');
 await assertTrustedPath(config.environment.tlsSecretRef.slice(5),{trustedRoot:'/',kind:'file',private:true});
 const tls=JSON.parse(await resolveSecret(config.environment.tlsSecretRef));
 const cert=new X509Certificate(tls.certificatePem);
 if(!cert.checkPrivateKey(createPrivateKey(tls.privateKeyPem))||!cert.checkHost(new URL(config.environment.publicUrl).hostname))throw new Error('ISOLATED_TLS_IDENTITY');
 await writeFile(directory+'/tls-fullchain.pem',tls.certificatePem,{mode:0o600,flag:'wx'});
 await writeFile(directory+'/tls-private-key.pem',tls.privateKeyPem,{mode:0o600,flag:'wx'});
 const ingress=createCloudNginxConfig({domain:new URL(config.environment.publicUrl).hostname,certificateFile:'/run/tls/cert.pem',certificateKeyFile:'/run/tls/key.pem'}).replaceAll('http://127.0.0.1:3000','http://web:3000').replaceAll('http://127.0.0.1:3200','http://api:3200');
 await writeFile(directory+'/shadow-nginx.conf','events {}\nhttp {\n'+ingress+'\n}',{mode:0o600,flag:'wx'});
 await writeFile(directory+'/compose.json',JSON.stringify(compose),{mode:0o600,flag:'wx'});
 return {runtimeDirectory:directory,sourceRevision:sha,images:request.images};
}
