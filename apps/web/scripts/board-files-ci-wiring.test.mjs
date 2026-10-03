import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..');
const probeEnv={...process.env,COMPOSE_PROJECT_NAME:'files-wiring-probe',WORKSPACEX_DB:'files_wiring_probe',PGPORT:'39003'};
for(const [i,role] of ['API','WEB','MODEL_PROVIDER','DEEP_AGENT_PROVIDER','ASR_PROVIDER','VISION_PROVIDER','LOOPBACK_SANDBOX','MAIL_PROVIDER'].entries())probeEnv[`WORKSPACEX_${role}_PORT`]=String(39001+i);
function run(args,env=probeEnv){const result=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);}
function configProbe(overrides={}){
 const env={...probeEnv,...overrides};if(!Object.hasOwn(overrides,'BOARD_ACCEPTANCE_RUNTIME_MARKER'))delete env.BOARD_ACCEPTANCE_RUNTIME_MARKER;if(!Object.hasOwn(overrides,'BOARD_ACCEPTANCE_RUNTIME_STARTED_AT'))delete env.BOARD_ACCEPTANCE_RUNTIME_STARTED_AT;
 return run(['--import','tsx','--input-type=module','-e',`const mod=await import('./apps/web/playwright.fullstack-smoke.config.ts');const config=mod.default.default??mod.default;console.log(JSON.stringify({marker:process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER,startedAt:process.env.BOARD_ACCEPTANCE_RUNTIME_STARTED_AT,files:config.projects.find(p=>p.name==='seeded-github-import').testMatch.filter(s=>s==='board-files-acceptance.spec.ts'),apiMarker:config.webServer.find(s=>s.env?.PORT===process.env.WORKSPACEX_API_PORT).env.WORKSPACEX_DEPLOYMENT_MARKER,reuse:config.webServer.map(s=>s.reuseExistingServer)}));`],env);
}
function assertWiring(value){assert.deepEqual(value.files,['board-files-acceptance.spec.ts']);assert.match(value.marker,/^[a-f0-9-]{36}$/);assert.equal(value.apiMarker,value.marker);assert(Number.isFinite(Date.parse(value.startedAt)));assert(value.reuse.every(reuse=>reuse===false));}
test('fullstack generates one fresh marker and start time shared by files worker and API',()=>assertWiring(configProbe()));
test('caller runtime identity is preserved, and missing spec/stale marker/reuse cannot satisfy the wiring',()=>{
 const marker='a1234567-1234-1234-1234-123456789abc',startedAt='2026-10-02T00:00:00Z',value=configProbe({BOARD_ACCEPTANCE_RUNTIME_MARKER:marker,BOARD_ACCEPTANCE_RUNTIME_STARTED_AT:startedAt});assertWiring(value);assert.equal(value.marker,marker);assert.equal(value.startedAt,startedAt);
 for(const wrong of [{...value,files:[]},{...value,apiMarker:'old'},{...value,reuse:[true]}])assert.throws(()=>assertWiring(wrong));
});
test('the actual existing fullstack command selects the R09 case exactly once without starting another stack',()=>{
 const pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));assert.equal(pkg.scripts['verify:fullstack-smoke:raw'],'pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded-github-import');
 const result=spawnSync('pnpm',['--filter','web','exec','playwright','test','--config','playwright.fullstack-smoke.config.ts','--project=seeded-github-import','--list','--reporter=json'],{cwd:root,env:probeEnv,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout),matches=[];
 const visit=s=>{for(const spec of s.specs??[])if(spec.file.endsWith('board-files-acceptance.spec.ts'))matches.push(spec);for(const child of s.suites??[])visit(child);};for(const suite of report.suites)visit(suite);
 assert.equal(matches.length,1);assert.equal(matches[0].tests.length,1);assert.equal(matches[0].tests[0].projectName,'seeded-github-import');
});
