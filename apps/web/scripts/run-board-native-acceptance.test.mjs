import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {resolveInvokedConfigs} from '../../../.harness/scripts/lint-spec-gate-coverage.mjs';
import {acceptanceCommand,suiteResult,suitePresent,runtimeExitProof,runtimeSpawnState,screenshotProof,safeStartupDiagnostics,startupFailureProof,sameRuntimeProof} from './run-board-native-acceptance.mjs';
import * as startupReceipts from '../e2e/support/native-runtime/native-startup-receipt.mjs';
test('startup failure uses sole parser and rejects missing, malformed and foreign-source receipts',()=>{
  const head='a'.repeat(40);
  const parsed={phase:'API',code:'ERR_ASSERTION',status:'failed',sourceHead:head};
  assert.deepEqual(startupFailureProof({readStartupFailure:()=>startupReceipts.parseStartupReceipt(parsed)},'',head),parsed);
  for(const value of [{...parsed,sourceHead:'b'.repeat(40)},{...parsed,status:'passed'},{...parsed,raw:'secret'}])assert.throws(()=>startupFailureProof({readStartupFailure:()=>startupReceipts.parseStartupReceipt(value)},'',head));
  assert.throws(()=>startupFailureProof(startupReceipts,'/definitely-missing/native-private-data',head));
});
const base=['--','pnpm','--filter','web','exec','playwright','test','--config'];
test('before/end sole runtime identity and manifest digest cannot drift',()=>{
  const before={manifestDigest:'original',identity:{head:'source',pid:123,marker:'deployment'}};
  sameRuntimeProof(before,structuredClone(before));
  for(const after of [{...before,manifestDigest:'other'},{...before,identity:{...before.identity,pid:124}},{...before,identity:{...before.identity,head:'other'}}])assert.throws(()=>sameRuntimeProof(before,after));
});
test('each workflow suite has its own exact checkout without discarding failed build evidence',()=>{
  const workflow=readFileSync(new URL('../../../.github/workflows/board-native-acceptance.yml',import.meta.url),'utf8');
  for(const suite of ['connectors','files','sync']){
    assert(workflow.includes(`git clone --no-hardlinks "$GITHUB_WORKSPACE" /private/tmp/wsx-native-${suite}`));
    assert(workflow.includes(`git -C /private/tmp/wsx-native-${suite} checkout --detach "$(git rev-parse HEAD)"`));
    assert(workflow.includes(`working-directory: /private/tmp/wsx-native-${suite}`));
  }
  assert(!workflow.includes('wsx-native-candidate'));assert(!workflow.includes('rm '));
});
test('R08 requires its metadata when any suite source exists, while whole absence is explicit',()=>{
  const config='e2e/board-peer-existing-runtime.config.ts';
  acceptanceCommand([...base,config]);assert.equal(suitePresent(config,[]),false);
  for(const partial of [[`apps/web/${config}`],['apps/web/e2e/board-sync-lifecycle.spec.ts'],['apps/web/e2e/support/r08/r08-native-adapter.mjs']])assert.throws(()=>suitePresent(config,partial));
});
test('R08 metadata requires every distinct project case and both viewport screenshot sets',()=>{
  const root=mkdtempSync('/private/tmp/wsx-r08-registry-'),config='e2e/board-peer-existing-runtime.config.ts';
  try{
    const directory=join(root,'apps/web/e2e/support/r08');mkdirSync(directory,{recursive:true});
    const metadata={config,files:['board-peer-origin-close.spec.ts','board-sync-lifecycle.spec.ts'],projects:[{name:'desktop',viewport:{width:1440}},{name:'mobile',viewport:{width:390}}],requiredScreenshotNames:['pending','acked']};
    writeFileSync(join(directory,'r08-native-suite.json'),JSON.stringify(metadata));
    assert.throws(()=>suitePresent(config,['apps/web/e2e/support/r08/r08-native-suite.json'],root));
    const report={suites:[{specs:metadata.files.map(file=>({file,ok:true,tests:metadata.projects.map(project=>({projectName:project.name,status:'expected',results:[{status:'passed'}]}))}))}],errors:[],stats:{expected:4,unexpected:0,flaky:0,skipped:0}};
    suiteResult(config,report,root);
    for(const mutate of [r=>r.suites[0].specs[0].tests.pop(),r=>r.suites[0].specs[0].tests[1].projectName='desktop',r=>r.stats.skipped=1]){const invalid=structuredClone(report);mutate(invalid);assert.throws(()=>suiteResult(config,invalid,root));}
    const images=metadata.projects.flatMap(project=>metadata.requiredScreenshotNames.map(name=>({originalName:`${name}-${project.viewport.width}.png`,width:project.viewport.width,height:900,bytes:100})));
    screenshotProof(config,images,root);assert.throws(()=>screenshotProof(config,images.slice(1),root));
  }finally{rmSync(root,{recursive:true});}
});
test('startup diagnostics expose only literal safe categories, never private log content',()=>{
  const secret='TOKEN=private-value SQL password=secret /private/machine/path';
  assert.deepEqual(safeStartupDiagnostics(secret),{matchedFailure:'UNKNOWN',ambiguous:false});
  assert.deepEqual(safeStartupDiagnostics(`${secret}\nnative-web-build failed; inspect private log`),{matchedFailure:'native-web-build',ambiguous:false});
  assert.deepEqual(safeStartupDiagnostics('native-migrate failed; inspect private log\nnative-web-build failed; inspect private log'),{matchedFailure:'UNKNOWN',ambiguous:true});
  assert.equal(JSON.stringify(safeStartupDiagnostics(secret)).includes('secret'),false);
});
test('only complete native connector and file configurations may execute',()=>{
  for(const config of ['e2e/board-connector-existing-runtime.config.ts','e2e/board-files-completion.config.ts'])assert.equal(acceptanceCommand([...base,config])[7],config);
  for(const args of [[...base,'e2e/other.config.ts'],[...base,'e2e/board-files-completion.config.ts','--list'],[...base,'e2e/board-files-completion.config.ts','--grep','plain'],['--','echo','passed'],[]])assert.throws(()=>acceptanceCommand(args));
});
const files=['board-files-boundaries.spec.ts','board-files-filenames.spec.ts','board-files-placement.spec.ts','board-files-retry.spec.ts'];
const report=()=>({stats:{expected:6,unexpected:0,flaky:0,skipped:0},errors:[],suites:[{specs:[0,1,1,2,2,3].map(index=>({file:files[index],ok:true,tests:[{status:'expected',results:[{status:'passed'}]}]}))}]});
test('empty, skipped, missing, foreign and unsuccessful reports cannot satisfy full suite',()=>{
  assert.equal(suiteResult('e2e/board-files-completion.config.ts',report()).expected,6);
  for(const mutate of [value=>value.suites=[],value=>value.stats.skipped=6,value=>value.suites[0].specs.pop(),value=>value.suites[0].specs[0].file='other.spec.ts',value=>value.stats.unexpected=1,value=>value.errors=[{}],value=>value.suites[0].specs[0].tests[0].results[0].status='skipped']){const value=report();mutate(value);assert.throws(()=>suiteResult('e2e/board-files-completion.config.ts',value));}
});
test('only wholly absent suite is ABSENT; partial config or orphan specs must fail',()=>{
  const config='e2e/board-files-completion.config.ts',complete=[`apps/web/${config}`,...files.map(file=>`apps/web/e2e/${file}`)];
  assert.equal(suitePresent(config,[]),false);assert.equal(suitePresent(config,complete),true);
  for(const partial of [complete.slice(1),complete.slice(0,1),complete.slice(0,-1),complete.slice(1,2)])assert.throws(()=>suitePresent(config,partial));
});
test('actual coverage resolver recognizes all three unconditional literal CI configurations',()=>{
  const root=mkdtempSync('/private/tmp/wsx-native-route-pure-');
  try{
    mkdirSync(join(root,'.github/workflows'),{recursive:true});mkdirSync(join(root,'apps/web/e2e'),{recursive:true});
    writeFileSync(join(root,'apps/web/package.json'),JSON.stringify({name:'web',scripts:{}}));
    writeFileSync(join(root,'.github/workflows/board-native-acceptance.yml'),readFileSync(new URL('../../../.github/workflows/board-native-acceptance.yml',import.meta.url)));
    for(const config of ['board-connector-existing-runtime.config.ts','board-files-completion.config.ts','board-peer-existing-runtime.config.ts'])writeFileSync(join(root,'apps/web/e2e',config),'');
    const routes=resolveInvokedConfigs(root);
    assert.deepEqual(routes.map(route=>route.configPath).sort(),['apps/web/e2e/board-connector-existing-runtime.config.ts','apps/web/e2e/board-files-completion.config.ts','apps/web/e2e/board-peer-existing-runtime.config.ts']);
    assert(routes.every(route=>route.unconditional===true));
  }finally{rmSync(root,{recursive:true});}
});
test('early runtime exit, failed stop and signal cannot prove cleanup',()=>{
  runtimeExitProof(0,null,true);
  for(const args of [[0,null,false],[1,null,true],[null,'SIGTERM',true]])assert.throws(()=>runtimeExitProof(...args));
});
test('actual missing runtime executable has a handled fail-closed spawn state',async()=>{
  const child=spawn('/definitely-not-present/wsx-native-runtime',{stdio:'ignore'}),state=runtimeSpawnState(child);
  await new Promise(resolve=>child.once('close',resolve));assert.equal(state.failed,true);
});
test('all required desktop, mobile, retry and native download PNGs are necessary',()=>{
  const names=['R09-placement-1440.png','R09-reloaded-1440.png','R09-placement-390.png','R09-reloaded-390.png','R09-real-backend-503.png','R09-real-backend-retry-refreshed.png',...Array.from({length:7},(_,index)=>`R09-native-download-${index}.png`)];
  const images=names.map(originalName=>({originalName,width:originalName.includes('390')?390:1440,bytes:100,height:900}));
  screenshotProof('files',images);
  for(const imagesToReject of [[],images.slice(1),images.filter(image=>image.width!==390),images.map(image=>({...image,bytes:0}))])assert.throws(()=>screenshotProof('files',imagesToReject));
});
