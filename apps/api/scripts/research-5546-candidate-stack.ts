import {randomBytes} from 'node:crypto';
import {ensureDatabase,migrateOnce} from '../tests/support/db';
import {execFileSync,spawn} from 'node:child_process';
import {writeFileSync,readFileSync,openSync,appendFileSync} from 'node:fs';
import {GUIDED_RUNTIME_SERVICE} from '../src/application/research/guided-runtime-ports';
import type {ModelCallPort} from '../src/application/agent-run/ports';
import {fileURLToPath} from 'node:url';
import {getDevModeAccount} from '@repo/dev-mode-accounts';
import {PgDatabase} from '../src/infrastructure/db/pg-database';
import {appConfig,migrationConfig} from '../src/infrastructure/db/pg-config';
import {PgGuidedResearchSessionRepository} from '../src/infrastructure/research/pg-guided-research-session-repository';
import {toOrgId} from '../src/domain/org-id';
import {PersistedResearchRuntimeSchema} from '../src/application/research/guided-runtime-persistence';
import {discloseDecided,isDisclosed} from '../src/application/security/permission-filter';
import {decideGuidedResearchVisibility} from '../src/domain/research/guided-research-visibility';
const dir=process.env.RESEARCH_5546_EVIDENCE_DIR??'/tmp/research-5546-full-20261010';
async function main(){
 const existingPath=process.env.RESEARCH_5546_EXISTING_STACK_METADATA;
 let actor: {user_id:string;org_id:string};let sessionId:string;
 if(existingPath){
  const existing=JSON.parse(readFileSync(existingPath,'utf8'));
  if(!existing.database.startsWith('wsx_')||existing.composeProject!=='wsx-'+existing.database.slice(4)||!existing.sessionId.startsWith('grs_'))throw new Error('Owned existing candidate mismatch');
  process.env.WORKSPACEX_DB=existing.database;process.env.PGDATABASE=existing.database;process.env.PGPORT=String(existing.pgPort);process.env.PGHOST='127.0.0.1';
  process.env.COMPOSE_PROJECT_NAME=existing.composeProject;process.env.REDIS_PORT=String(existing.pgPort+1000);
  actor={user_id:existing.userId,org_id:existing.orgId};sessionId=existing.sessionId;
  // The original isolation wrapper retains ownership. No migration, seed,
  // fixture/state mutation or copying of an approved report occurs here.
 }else{
 if(!process.env.COMPOSE_PROJECT_NAME?.startsWith('wsx-')||!process.env.WORKSPACEX_DB?.startsWith('wsx_'))throw new Error('Owned isolation wrapper is required');
 ensureDatabase();execFileSync('docker',['compose','-f',fileURLToPath(new URL('../docker-compose.dev.yml',import.meta.url)),'-p',process.env.COMPOSE_PROJECT_NAME!,'up','-d','--wait','redis'],{stdio:'pipe'});await migrateOnce();
 execFileSync('pnpm',['--filter','@repo/api','exec','tsx','scripts/seed-dev-mode-accounts.ts'],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),env:{...process.env,WORKSPACEX_DEV_MODE:'1'},stdio:['ignore',openSync(`${dir}/dev-seed.txt`,'w',0o600),openSync(`${dir}/dev-seed-errors.txt`,'w',0o600)]});
 const ownerDb=new PgDatabase(migrationConfig());const account=getDevModeAccount('consultant');
 actor=await ownerDb.withoutTenant(async tx=>{const result=await tx.query<{user_id:string;org_id:string}>(`SELECT c.user_id,m.org_id FROM credentials c JOIN org_memberships m ON m.user_id=c.user_id WHERE c.email=$1`,[account.email]);if(!result.rows[0])throw new Error('Owned test account missing');return result.rows[0];});
 await ownerDb.close();
 const db=new PgDatabase(appConfig());const repository=new PgGuidedResearchSessionRepository(db);
 const state=PersistedResearchRuntimeSchema.parse(JSON.parse(readFileSync(`${dir}/input-runtime.json`,'utf8')));
 const created=await repository.create({orgId:toOrgId(actor.org_id),ownerUserId:actor.user_id,idempotencyKey:'5546-full-candidate',title:'完整报告生成修复验收',tags:[],collaboratorUserIds:[],brief:state.brief});
 const disclosed=discloseDecided(created.item,decideGuidedResearchVisibility({decisionId:'5546-owned-fixture',ownerUserId:created.ownerUserId,viewerUserId:actor.user_id,isExplicitCollaborator:created.isExplicitCollaborator}));
 if(!isDisclosed(disclosed))throw new Error('Owned fixture access rejected');
 sessionId=disclosed.payload.sessionId;state.sessionId=sessionId;
 await db.withTenant(toOrgId(actor.org_id),async tx=>{await tx.query(`INSERT INTO guided_research_runtime(org_id,session_id,state) VALUES($1,$2,$3::jsonb)`,[actor.org_id,sessionId,JSON.stringify(state)]);});
 await db.close();
 }
 process.env.KERNEL_QUIET='1';process.env.MODEL_CREDENTIAL_KEY??=randomBytes(32).toString('base64');
 const {createApp}=await import('../src/main');const app=await createApp();
 // Owned acceptance fixture only: observe the real adapters losslessly. Private
 // request/response material stays in the mode-0600 local evidence directory.
 const service=app.get<{model:ModelCallPort;reportModel:ModelCallPort}>(GUIDED_RUNTIME_SERVICE);
 let dispatches=process.env.RESEARCH_5546_DISPATCH_OFFSET?Number(process.env.RESEARCH_5546_DISPATCH_OFFSET):0;const seen=new Set<ModelCallPort>();
 for(const port of [service.model,service.reportModel]){
  if(seen.has(port))continue;seen.add(port);
  const complete=port.complete.bind(port);const stream=port.completeStream?.bind(port);
  const observe=async(input:Parameters<ModelCallPort['complete']>[0],run:()=>ReturnType<ModelCallPort['complete']>)=>{
   const id=++dispatches;const request={id,modelProvider:input.modelProvider,modelId:input.modelId,system:input.system,user:input.user,responseSchema:input.responseSchema};
   appendFileSync(`${dir}/candidate-model-transcript.jsonl`,JSON.stringify({event:'request',...request})+'\n',{mode:0o600});
   try{const result=await run();appendFileSync(`${dir}/candidate-model-transcript.jsonl`,JSON.stringify({event:'response',id,text:result.text})+'\n',{mode:0o600});return result;}
   catch(error){const e=error as {name?:string;code?:string;reasonCode?:string;contentRejection?:string;detail?:string};appendFileSync(`${dir}/candidate-model-transcript.jsonl`,JSON.stringify({event:'failure',id,type:e.name,code:e.code,reasonCode:e.reasonCode,contentRejection:e.contentRejection,httpStatus:e.detail?.match(/HTTP (\d{3})/)?.[1]})+'\n',{mode:0o600});throw error;}
  };
  port.complete=input=>observe(input,()=>complete(input));
  if(stream)port.completeStream=(input,onDelta)=>observe(input,()=>stream(input,onDelta));
 }
 const apiPort=Number(process.env.WORKSPACEX_API_PORT);const webPort=Number(process.env.WORKSPACEX_WEB_PORT);await app.listen(apiPort,'127.0.0.1');
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 const web=spawn('pnpm',['--filter','web','exec','next','dev','--hostname','127.0.0.1','--port',String(webPort)],{cwd:root,detached:true,env:{...process.env,FULLSTACK_E2E_API_ORIGIN:`http://127.0.0.1:${apiPort}`,NEXT_PUBLIC_API_URL:`http://127.0.0.1:${webPort}`,NEXT_PUBLIC_API_PATH_PREFIX:'/__fullstack_api',NEXT_DIST_DIR:existingPath?'.next-research-5546-current':'.next-research-5546'},stdio:['ignore',openSync(`${dir}/web-server.txt`,'w',0o600),openSync(`${dir}/web-server-errors.txt`,'w',0o600)]});
 writeFileSync(`${dir}/candidate-stack.json`,JSON.stringify({apiPort,webPort,apiPid:process.pid,pgPort:Number(process.env.PGPORT),sessionId,orgId:actor.org_id,userId:actor.user_id,composeProject:process.env.COMPOSE_PROJECT_NAME,database:process.env.WORKSPACEX_DB,webPid:web.pid}),{mode:0o600});
 console.log(JSON.stringify({event:'candidate_ready',apiPort,webPort,sessionId,composeProject:process.env.COMPOSE_PROJECT_NAME}));
 const shutdown=()=>new Promise<void>(resolve=>{const close=async()=>{const deadline=setTimeout(()=>process.exit(0),5000);deadline.unref();if(web.pid)try{process.kill(-web.pid,'SIGTERM');}catch{}await app.close();resolve();};process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());});
 await shutdown();
}
main().catch((e:any)=>{console.log(JSON.stringify({event:'candidate_failed',type:e.name,code:e.code??e.reasonCode,message:e.message?.replace(/postgres(?:ql)?:\/\/[^\s]+/g,'[database redacted]').slice(0,300)}));process.exitCode=1;});
