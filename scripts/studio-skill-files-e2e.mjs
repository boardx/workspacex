import { randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, open, writeFile, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import 'tsx/esm';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { withStudioIsolation, assertStudioReport } = await import('./studio-skill-files-guards.ts');
await withStudioIsolation(async () => {
const evidence=await mkdtemp(join(tmpdir(),`studio-browser-${process.env.COMPOSE_PROJECT_NAME}-`));
const distName=`.next-studio-${process.env.COMPOSE_PROJECT_NAME}-${randomBytes(4).toString('hex')}`;
const children=[]; const logs=[];
const gitHead=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const env={...process.env, STUDIO_GIT_HEAD:gitHead, STUDIO_LANE:'1', WORKSPACEX_DEV_MODE:'1', MODEL_CREDENTIAL_KEY:randomBytes(32).toString('hex'), KERNEL_ALLOW_TEST_PRINCIPAL:'0', KERNEL_AGENT_RUN_AUTOSTART:'0', KERNEL_QUIET:'1', NEXT_TELEMETRY_DISABLED:'1'};
function processCommand(cmd,args,name,cwd=root, extra={}) {
  return open(`${evidence}/${name}.log`,'wx').then(log=>{
    logs.push(log); const child=spawn(cmd,args,{cwd,env:{...env,...extra},detached:true,stdio:['ignore',log.fd,log.fd]});
    children.push(child); return child;
  });
}
async function run(cmd,args,name,cwd=root,extra={}) {
  const child=await processCommand(cmd,args,name,cwd,extra);
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${name} failed ${code}; see ${evidence}/${name}.log`)));});
}
async function ready(url,child){
  const until=Date.now()+240000;
  while(Date.now()<until){
    if(child.exitCode!==null)throw new Error(`server exited ${child.exitCode}`);
    try {if((await fetch(url,{signal:AbortSignal.timeout(3000)})).ok)return;}catch{}
    await new Promise(r=>setTimeout(r,1000));
  } throw new Error(`readiness timeout ${url}`);
}
let cleaning=false;
async function cleanup(){ if(cleaning)return;cleaning=true;
  for(const child of children.reverse())if(child.pid&&child.exitCode===null){try{process.kill(-child.pid,'SIGTERM');}catch{}}
  await new Promise(r=>setTimeout(r,1500));
  for(const child of children)if(child.pid&&child.exitCode===null){try{process.kill(-child.pid,'SIGKILL');}catch{}}
  for(const log of logs)await log.close().catch(()=>{});
  // Next dev appends its dist to tsconfig; remove only this run's exact generated entry.
  await rm(join(root,'apps/web',distName),{recursive:true,force:true});
  const tsconfig=join(root,'apps/web/tsconfig.json');
  const source=await readFile(tsconfig,'utf8');
  const line=`,\n    "${distName}/types/**/*.ts"`;
  if(source.includes(line))await writeFile(tsconfig,source.replace(line,''));
}
process.on('SIGTERM',()=>{cleanup().finally(()=>process.exit(143));});process.on('SIGINT',()=>{cleanup().finally(()=>process.exit(130));});
try {
  // Exactly one owned compose project; outer isolation wrapper releases its services.
  await run('docker',['compose','-f','apps/api/docker-compose.dev.yml','-p',env.COMPOSE_PROJECT_NAME,'up','-d','--wait','postgres','redis','minio'],'infra');
  await run('pnpm',['exec','tsx','scripts/studio-skill-files-init-db.mts'],'migrate');
  await run('pnpm',['--filter','@repo/api','exec','tsx','scripts/seed-dev-mode-accounts.ts'],'seed');
  const api=await processCommand('pnpm',['--filter','@repo/api','start'],'api',root,{PORT:env.WORKSPACEX_API_PORT});
  const apiOrigin=`http://127.0.0.1:${env.WORKSPACEX_API_PORT}`;
  await ready(`${apiOrigin}/healthz`,api);
  const webOrigin=`http://127.0.0.1:${env.WORKSPACEX_WEB_PORT}`;
  const web=await processCommand('pnpm',['exec','next','dev','-H','127.0.0.1','-p',env.WORKSPACEX_WEB_PORT],'web',`${root}/apps/web`,{
    NEXT_DIST_DIR:distName, NEXT_PUBLIC_API_URL:webOrigin,
    NEXT_PUBLIC_API_PATH_PREFIX:'/__fullstack_api', FULLSTACK_E2E_API_ORIGIN:apiOrigin,
  });
  await ready(`${webOrigin}/login`,web);
  await writeFile(`${evidence}/environment.json`,JSON.stringify({gitHead,apiOrigin,webOrigin,compose:env.COMPOSE_PROJECT_NAME,database:env.PGDATABASE,modelExecuted:false},null,2));
  await run('pnpm',['exec','playwright','test','--config','playwright.skill-files.config.ts'],'browser',`${root}/apps/web`,{
    E2E_BASE_URL:webOrigin,STUDIO_API_BASE_URL:apiOrigin,STUDIO_LOCAL_DEV_MODE:'1',STUDIO_EVIDENCE_DIR:`${evidence}/results`,
  });
  const report=JSON.parse(await readFile(join(evidence,'results','playwright-report.json'),'utf8'));
  assertStudioReport(report);
  console.log(`BROWSER_PASS ${evidence}`);
}finally {await cleanup();console.log(`OWNED_PROCESSES_CLEANED ${evidence}`);}

});
