import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {resolveInvokedConfigs} from '../../../.harness/scripts/lint-spec-gate-coverage.mjs';
import {acceptanceCommand,suiteDefinition,suiteResult,suitePresent,runtimeExitProof,runtimeSpawnState,screenshotProof,safeStartupDiagnostics,startupFailureProof,sameRuntimeProof,r01ResultSummary,r01ReportReceipts} from './run-board-native-acceptance.mjs';
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
  for(const suite of ['r01','connectors','files','sync']){
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
  const diagnosticInput='TOKEN=private-value SQL password=secret /private/machine/path';
  assert.deepEqual(safeStartupDiagnostics(diagnosticInput),{matchedFailure:'UNKNOWN',ambiguous:false});
  assert.deepEqual(safeStartupDiagnostics(`${diagnosticInput}\nnative-web-build failed; inspect private log`),{matchedFailure:'native-web-build',ambiguous:false});
  assert.deepEqual(safeStartupDiagnostics('native-migrate failed; inspect private log\nnative-web-build failed; inspect private log'),{matchedFailure:'UNKNOWN',ambiguous:true});
  assert.equal(JSON.stringify(safeStartupDiagnostics(diagnosticInput)).includes('secret'),false);
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
test('actual coverage resolver recognizes all four unconditional literal CI configurations',()=>{
  const root=mkdtempSync('/private/tmp/wsx-native-route-pure-');
  try{
    mkdirSync(join(root,'.github/workflows'),{recursive:true});mkdirSync(join(root,'apps/web/e2e'),{recursive:true});
    writeFileSync(join(root,'apps/web/package.json'),JSON.stringify({name:'web',scripts:{}}));
    writeFileSync(join(root,'.github/workflows/board-native-acceptance.yml'),readFileSync(new URL('../../../.github/workflows/board-native-acceptance.yml',import.meta.url)));
    for(const config of ['board-connector-existing-runtime.config.ts','board-files-completion.config.ts','board-peer-existing-runtime.config.ts','board-r01-existing-runtime.config.ts'])writeFileSync(join(root,'apps/web/e2e',config),'');
    const routes=resolveInvokedConfigs(root);
    assert.deepEqual(routes.map(route=>route.configPath).sort(),['apps/web/e2e/board-connector-existing-runtime.config.ts','apps/web/e2e/board-files-completion.config.ts','apps/web/e2e/board-peer-existing-runtime.config.ts','apps/web/e2e/board-r01-existing-runtime.config.ts']);
    assert(routes.every(route=>route.unconditional===true));
  }finally{rmSync(root,{recursive:true});}
});
test('R01 requires eight distinct signed title-project cases, not a repeated passing count',()=>{
 const config='e2e/board-r01-existing-runtime.config.ts',definition=suiteDefinition(config);
 acceptanceCommand([...base,config]);
 const report={suites:[{specs:definition.titles.map(title=>({file:definition.files[0],title,ok:true,tests:definition.projects.map(projectName=>({projectName,status:'expected',results:[{status:'passed'}]}))}))}],errors:[],stats:{expected:8,unexpected:0,flaky:0,skipped:0}};
 suiteResult(config,report);
 for(const mutate of [r=>r.suites[0].specs.pop(),r=>r.suites[0].specs[1].title=r.suites[0].specs[0].title,r=>r.suites[0].specs[0].tests[1].projectName='r01-native-1440',r=>r.stats.skipped=1]){const invalid=structuredClone(report);mutate(invalid);assert.throws(()=>suiteResult(config,invalid));}
 assert.throws(()=>screenshotProof(config,[{originalName:'any.png',width:1440,height:900,bytes:100},{originalName:'any-mobile.png',width:390,height:844,bytes:100}]));
 const names=[...['middle','right'].flatMap(button=>['release','escape','pointercancel','blur'].map(finish=>`${button}-${finish}-held`)),...['Control','Meta'].flatMap(modifier=>[`pointer-zoom-${modifier}`,`pointer-zoom-out-${modifier}`]),'multi-erase-held','multi-erase-protected','multi-erase-refreshed',...['move','rotate','scale'].flatMap(gesture=>[`multi-${gesture}-cancel-held`,`multi-${gesture}-commit-held`,`multi-${gesture}-canceled`,`multi-${gesture}-refreshed`])],images=[1440,390].flatMap(width=>names.flatMap(name=>Array.from({length:name.startsWith('multi-')&&!name.startsWith('multi-erase-')?2:1},()=>({originalName:`${name}-${width}.png`,width,height:900,bytes:100}))));
 screenshotProof(config,images);assert.throws(()=>screenshotProof(config,images.slice(1)));assert.throws(()=>screenshotProof(config,[...images,images[0]]));assert.throws(()=>screenshotProof(config,images.filter((image,index)=>!(image.originalName==='multi-scale-refreshed-390.png'&&index===images.length-1))));
});
test('R01 final projection never publishes private fields or treats preserved boards and hardware as completed',()=>{
 const definition=suiteDefinition('e2e/board-r01-existing-runtime.config.ts'),head='a'.repeat(40),proof={identity:{head},manifestHash:'1'.repeat(64),verifierHash:'2'.repeat(64),selectorHash:'3'.repeat(64)},receipts=definition.titles.flatMap(title=>definition.projects.map(project=>({source:head,testIdentity:{title,project},status:'functional-cases-passed',completed:false,cleanupPending:true,hardwareTrackpad:'unverified',boardId:'private-id',title:'private-title',beforeProof:structuredClone(proof),afterProof:structuredClone(proof)})));
 assert.deepEqual(r01ResultSummary(receipts,head),{functionalCasesPassed:8,completed:false,cleanupPending:true,hardwareTrackpad:'unverified',requiredSuiteComplete:false});
 for(const values of [receipts.slice(1),receipts.map(()=>receipts[0]),receipts.map(value=>({...value,source:'b'.repeat(40)})),receipts.map(value=>({...value,status:'failed'})),receipts.map(value=>({...value,completed:true}))])assert.throws(()=>r01ResultSummary(values,head));
 for(const mutate of [r=>delete r[0].beforeProof,r=>r[0].beforeProof.identity.head='b'.repeat(40),r=>r[0].afterProof.identity.head='b'.repeat(40),r=>r[0].afterProof.selectorHash='4'.repeat(64),r=>{r[0].beforeProof.verifierHash='bad';r[0].afterProof.verifierHash='bad';}]){const invalid=structuredClone(receipts);mutate(invalid);assert.throws(()=>r01ResultSummary(invalid,head));}
});
test('R01 receipts bind each real report result attachment, rejecting reused, foreign and missing paths',()=>{
 const directory=mkdtempSync('/private/tmp/wsx-r01-report-'),head='a'.repeat(40),definition=suiteDefinition('e2e/board-r01-existing-runtime.config.ts');
 try{
  const specs=definition.titles.map((title,index)=>({title,tests:definition.projects.map((projectName,project)=>{const path=join(directory,`${index}-${project}`);mkdirSync(path);const receiptPath=join(path,'r01-result.json');writeFileSync(receiptPath,JSON.stringify({source:head,testIdentity:{title,project:projectName}}));return{projectName,results:[{attachments:[{name:'r01-result',path:receiptPath}]}]};})})),report={suites:[{specs}]};
  assert.equal(r01ReportReceipts(report,directory,head).length,8);
  for(const mutate of [r=>r.suites[0].specs[0].tests[0].results[0].attachments=[],r=>r.suites[0].specs[1].tests[0].results[0].attachments=r.suites[0].specs[0].tests[0].results[0].attachments,r=>r.suites[0].specs[0].tests[0].results[0].attachments[0].path='/etc/hosts',r=>r.suites[0].specs[0].tests[0].projectName='foreign']){const invalid=structuredClone(report);mutate(invalid);assert.throws(()=>r01ReportReceipts(invalid,directory,head));}
  assert.throws(()=>r01ReportReceipts(report,directory,'b'.repeat(40)));
 }finally{rmSync(directory,{recursive:true});}
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

test('real R08 screenshot metadata includes its 503 case and rejects unsafe basenames',()=>{
  const config='e2e/board-peer-existing-runtime.config.ts';
  const real=suiteDefinition(config);
  assert.equal(real.count,4);assert.equal(real.screenshots.length,24);
  assert(real.screenshots.includes('peer-real-503-recovered-390.png'));
  assert(real.screenshots.includes('peer-real-503-recovered-1440.png'));
  const root=mkdtempSync('/private/tmp/wsx-r08-basename-');
  try{
    const directory=join(root,'apps/web/e2e/support/r08');mkdirSync(directory,{recursive:true});
    const metadata=JSON.parse(readFileSync('apps/web/e2e/support/r08/r08-native-suite.json','utf8'));
    for(const name of ['../escaped','nested/file','name.png','','-leading','double--dash','UPPER','space name']){
      writeFileSync(join(directory,'r08-native-suite.json'),JSON.stringify({...metadata,requiredScreenshotNames:[name]}));
      assert.throws(()=>suiteDefinition(config,root));
    }
  }finally{rmSync(root,{recursive:true});}
});

test('private reporter first failure exposes fixed categories and bounded ordinal only',async()=>{
  const {safeAcceptanceDiagnostics}=await import('./run-board-native-acceptance.mjs');
  const config='e2e/board-files-completion.config.ts';
  const report=message=>({suites:[{title:'private token',specs:[{file:'/private/secret/board-files-boundaries.spec.ts',title:'user-private-title',tests:[{results:[{status:'failed',errors:[{message,stack:'private env URL password'}]}]}]}]}]});
  const actual=safeAcceptanceDiagnostics(config,report('Unreviewed runtime verifier cannot satisfy acceptance private token'));
  assert.deepEqual(actual,{version:1,firstFailure:{phase:'CASE',caseIndex:0,resultStatus:'failed',errorCount:1,matchedFailure:'VERIFIER_PIN',ambiguous:false,sourceLocation:null}});
  for(const secret of ['private','token','password','URL','title','stack','secret'])assert.equal(JSON.stringify(actual).includes(secret),false);
  assert.equal(safeAcceptanceDiagnostics(config,report('user arbitrary private content')).firstFailure.matchedFailure,'UNKNOWN');
  assert.equal(safeAcceptanceDiagnostics(config,report("browserType.launch: Executable doesn't exist at /private/browser")).firstFailure.matchedFailure,'BROWSER_EXECUTABLE');
  assert.equal(safeAcceptanceDiagnostics(config,report('expect(private-secret).toEqual(private-value)')).firstFailure.matchedFailure,'ASSERTION');
  assert.equal(safeAcceptanceDiagnostics(config,report('Unreviewed runtime verifier cannot satisfy acceptance browserType.launch:')).firstFailure.ambiguous,true);
});

test('reporter diagnostics retain first observed failure and never turn missing or failed cases into acceptance',async()=>{
  const {safeAcceptanceDiagnostics}=await import('./run-board-native-acceptance.mjs');
  const config='e2e/board-files-completion.config.ts';
  const report={suites:[{specs:[{file:'board-files-boundaries.spec.ts',tests:[{results:[{status:'passed'}]},{results:[{status:'timedOut',errors:[{message:'private timeout'}]}]},{results:[{status:'failed',errors:[{message:'expect(private)'}]}]}]}]}]};
  assert.equal(safeAcceptanceDiagnostics(config,report).firstFailure.caseIndex,1);
  assert.equal(safeAcceptanceDiagnostics(config,report).firstFailure.matchedFailure,'TIMEOUT');
  assert.throws(()=>suiteResult(config,report));
  assert.deepEqual(safeAcceptanceDiagnostics(config,{}),{version:1,firstFailure:null});assert.throws(()=>suiteResult(config,{}));
  const global=safeAcceptanceDiagnostics(config,{errors:[{message:'private-token',code:'ERR_ASSERTION'}]});
  assert.deepEqual(global.firstFailure,{phase:'REPORT',caseIndex:null,resultStatus:null,errorCount:1,matchedFailure:'ASSERTION',ambiguous:false});
  const unknown=safeAcceptanceDiagnostics(config,{suites:[{specs:[{file:'private-unrecognized-path',tests:[{results:[{status:'interrupted',error:{message:'secret'}}]}]}]}]});
  assert.equal(unknown.firstFailure.caseIndex,null);assert.equal(unknown.firstFailure.resultStatus,'interrupted');
  assert.throws(()=>safeAcceptanceDiagnostics('private-config',{}));
});

test('safe diagnostics use the main metadata suite authority for sync case ordinals',async()=>{
  const {safeAcceptanceDiagnostics}=await import('./run-board-native-acceptance.mjs');
  const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const root=mkdtempSync(join(tmpdir(),'native-safe-metadata-')),config='e2e/board-peer-existing-runtime.config.ts';
  try{
    const support=join(root,'apps/web/e2e/support/r08');mkdirSync(support,{recursive:true});
    writeFileSync(join(support,'r08-native-suite.json'),JSON.stringify({config,files:['board-sync-a.spec.ts','board-sync-b.spec.ts'],projects:[{name:'desktop',viewport:{width:1440}},{name:'mobile',viewport:{width:390}}],requiredScreenshotNames:['native-proof']}));
    const report={suites:[{specs:[{file:'board-sync-a.spec.ts',tests:[{results:[{status:'failed',errors:[{message:'private metadata detail'}]}]}]}]}]};
    assert.equal(safeAcceptanceDiagnostics(config,report,root).firstFailure.caseIndex,0);
    rmSync(join(support,'r08-native-suite.json'));assert.throws(()=>safeAcceptanceDiagnostics(config,report,root));
  }finally{rmSync(root,{recursive:true});}
});


test('end verification retains fixed cause and bounded facts without changing the cleanup block',async()=>{
 const {safeEndRuntimeFailure}=await import('./run-board-native-acceptance.mjs');
 const facts={service:'web',pidAlive:false,commandExit:null,pathPresent:false,pathEqual:false,childExitCode:1,childSignal:null};
 const error=Object.assign(new Error('private credential URL /private/path'),{code:'IDENTITY_CWD',identityCwd:facts});
 assert.deepEqual(safeEndRuntimeFailure(error),{code:'IDENTITY_CWD',identityCwd:facts,identityListener:null});
 const listener={service:'api',pidAlive:true,commandExit:null,listenerCount:0,ancestryVerified:false,childExitCode:null,childSignal:null};
 assert.deepEqual(safeEndRuntimeFailure(Object.assign(new Error('secret'),{code:'IDENTITY_LISTENER',identityListener:listener})),{code:'IDENTITY_LISTENER',identityCwd:null,identityListener:listener});
 for(const invalid of [{...facts,path:'/private'}, {...facts,childExitCode:1.5}, {...facts,service:'foreign'}, {...facts,pidAlive:'private'}])assert.equal(safeEndRuntimeFailure(Object.assign(error,{identityCwd:invalid})).identityCwd,null);
 const getter=new Error('secret');Object.defineProperty(getter,'identityCwd',{get(){throw new Error('must not execute')}});assert.equal(safeEndRuntimeFailure(getter).identityCwd,null);
 const output=safeEndRuntimeFailure(Object.assign(new Error('private data'),{code:'PRIVATE_CODE',identityListener:{...listener,private:'secret'}}));assert.deepEqual(output,{code:'UNKNOWN',identityCwd:null,identityListener:null});
 assert.ok(!JSON.stringify(output).includes('private'));
 const source=readFileSync(new URL('./run-board-native-acceptance.mjs',import.meta.url),'utf8');
 assert.match(source,/endRuntimeFailure=safeEndRuntimeFailure\(error\);cleanupFailures.push\('END_RUNTIME_IDENTITY_CHANGED'\)/);
 assert.match(source,/cleanupCompleted=cleanupFailures.length===0/);
 assert.throws(()=>sameRuntimeProof({identity:{pid:1}},{identity:{pid:2}}));
});
test('private first errors classify fixed identity causes without exporting messages',async()=>{
 const {safeAcceptanceDiagnostics}=await import('./run-board-native-acceptance.mjs');
 const config='e2e/board-r01-existing-runtime.config.ts';
 const report=error=>({suites:[{specs:[{file:'board-r01-native-matrix.spec.ts',tests:[{results:[{status:'failed',errors:[error]}]}]}]}]});
 for(const code of ['IDENTITY_SOURCE','IDENTITY_CWD','IDENTITY_LISTENER','IDENTITY_ANCESTRY']){
  const output=safeAcceptanceDiagnostics(config,report({message:'private token',code}));assert.equal(output.firstFailure.matchedFailure,code);assert.ok(!JSON.stringify(output).includes('private'));
  assert.equal(safeAcceptanceDiagnostics(config,report({message:code})).firstFailure.matchedFailure,code);
 }
 assert.equal(safeAcceptanceDiagnostics(config,report({message:'private IDENTITY_CWD suffix'})).firstFailure.matchedFailure,'UNKNOWN');
});


test('end identity diagnostics never execute changing code or nested context accessors',async()=>{
 const {safeEndRuntimeFailure}=await import('./run-board-native-acceptance.mjs');
 let codeReads=0;const error=new Error('private original');
 Object.defineProperty(error,'code',{get(){return ++codeReads===1?'IDENTITY_CWD':'private-code-leak';}});
 assert.deepEqual(safeEndRuntimeFailure(error),{code:'UNKNOWN',identityCwd:null,identityListener:null});assert.equal(codeReads,0);
 const facts={service:'web',pidAlive:true,commandExit:null,pathPresent:true,pathEqual:true,childExitCode:null,childSignal:null};
 for(const field of Object.keys(facts)){
  let reads=0;const context={...facts};Object.defineProperty(context,field,{enumerable:true,get(){return ++reads===1?facts[field]:'private-context-leak';}});
  const result=safeEndRuntimeFailure(Object.assign(new Error('private original'),{code:'IDENTITY_CWD',identityCwd:context}));
  assert.deepEqual(result,{code:'IDENTITY_CWD',identityCwd:null,identityListener:null});assert.equal(reads,0);assert.ok(!JSON.stringify(result).includes('private'));
 }
 const listener={service:'api',pidAlive:true,commandExit:null,listenerCount:1,ancestryVerified:true,childExitCode:null,childSignal:null};
 for(const field of Object.keys(listener)){
  let reads=0;const context={...listener};Object.defineProperty(context,field,{enumerable:true,get(){return ++reads===1?listener[field]:'private-context-leak';}});
  assert.equal(safeEndRuntimeFailure(Object.assign(new Error('secret'),{code:'IDENTITY_LISTENER',identityListener:context})).identityListener,null);assert.equal(reads,0);
 }
});

test('fixed listener probe stages survive end receipts without exposing causes or accessors',async()=>{
 const {safeEndRuntimeFailure}=await import('./run-board-native-acceptance.mjs');
 const cause=Object.assign(new Error('private kernel path'),{nativeListenerFailure:{stage:'LIST_DESCRIPTORS',cause:'ENOENT'}});
 const error=Object.assign(new Error('private wrapper',{cause}),{code:'IDENTITY_LISTENER'});
 assert.deepEqual(safeEndRuntimeFailure(error).nativeListenerFailure,{stage:'LIST_DESCRIPTORS',cause:'ENOENT'});
 const extended={stage:'LIST_DESCRIPTORS',cause:'EACCES',relation:'DESCENDANT',state:'Z',uidEqual:true};
 cause.nativeListenerFailure=extended;
 assert.deepEqual(safeEndRuntimeFailure(error).nativeListenerFailure,extended);
 for(const invalid of [{...extended,relation:'PRIVATE'},{...extended,state:'PRIVATE'},{...extended,uidEqual:1000},{...extended,pid:100},{...extended,uid:1000},{...extended,path:'/private'},{...extended,command:'secret'}]){
  cause.nativeListenerFailure=invalid;assert.equal(safeEndRuntimeFailure(error).nativeListenerFailure,undefined);
 }
 for(const field of Object.keys(extended)){
  let reads=0;const details={...extended};Object.defineProperty(details,field,{enumerable:true,get(){reads++;return 'private';}});
  cause.nativeListenerFailure=details;assert.equal(safeEndRuntimeFailure(error).nativeListenerFailure,undefined);assert.equal(reads,0);
 }
 for(const invalid of [{stage:'PRIVATE',cause:'ENOENT'},{stage:'LIST_DESCRIPTORS',cause:'PRIVATE'},{stage:'LIST_DESCRIPTORS',cause:'ENOENT',path:'/private'}]){
  cause.nativeListenerFailure=invalid;assert.equal(safeEndRuntimeFailure(error).nativeListenerFailure,undefined);
 }
 for(const field of ['stage','cause']){
  let reads=0;const details={stage:'LIST_DESCRIPTORS',cause:'ENOENT'};Object.defineProperty(details,field,{enumerable:true,get(){reads++;return 'private';}});
  cause.nativeListenerFailure=details;assert.equal(safeEndRuntimeFailure(error).nativeListenerFailure,undefined);assert.equal(reads,0);
 }
 let reads=0;Object.defineProperty(cause,'nativeListenerFailure',{get(){reads++;return {stage:'LIST_DESCRIPTORS',cause:'ENOENT'};}});
 assert.equal(safeEndRuntimeFailure(error).nativeListenerFailure,undefined);assert.equal(reads,0);
 const accessor=new Error('private');Object.defineProperty(accessor,'cause',{get(){reads++;return cause;}});accessor.code='IDENTITY_LISTENER';
 assert.equal(safeEndRuntimeFailure(accessor).nativeListenerFailure,undefined);assert.equal(reads,0);
});


test('safe acceptance source location uses known source fields only, preserving definition provenance',async()=>{
 const {safeAcceptanceDiagnostics}=await import('./run-board-native-acceptance.mjs');
 const config='e2e/board-connector-existing-runtime.config.ts',file='board-connector-authority.spec.ts';
 const inspect=(spec,error)=>safeAcceptanceDiagnostics(config,{suites:[{specs:[{...spec,tests:[{results:[{status:'failed',errors:[error]}]}]}]}]}).firstFailure;
 assert.deepEqual(inspect({file,line:12},{location:{file,line:34},message:'expect(private)',stack:'private'}).sourceLocation,{source:'ASSERTION',file,line:34});
 assert.deepEqual(inspect({file,line:12},{location:{file:'board-connector-history.spec.ts',line:34}}).sourceLocation,{source:'TEST_DEFINITION',file,line:12});
 for(const line of [0,-1,1.5,Infinity,1000001,'34',null])assert.equal(inspect({file},{location:{file,line}}).sourceLocation,null);
 for(const badFile of ['private.spec.ts',`/private/${file}`,`https://secret/${file}`,`${file} suffix`])assert.equal(inspect({file:badFile,line:12},{location:{file:badFile,line:34}}).sourceLocation,null);
 const getter=()=>{throw new Error('private getter must not run');};
 assert.equal(inspect({file},{location:Object.defineProperty({file},'line',{get:getter})}).sourceLocation,null);
 assert.equal(inspect(Object.defineProperty({},'line',{get:getter}),{}).sourceLocation,null);
 assert.equal(inspect({file},Object.defineProperty({},'location',{get:getter})).sourceLocation,null);
 const accessorSpec=Object.defineProperty({tests:[{results:[{status:'failed',errors:[{}]}]}]},'file',{get:getter});
 assert.equal(safeAcceptanceDiagnostics(config,{suites:[{specs:[accessorSpec]}]}).firstFailure.sourceLocation,null);
 const output=inspect({file,line:12},{location:{file,line:34,url:'private',column:999,unknown:'secret'},stack:'private',message:'expect(private)'});
 assert.equal(JSON.stringify(output).includes('private'),false);assert.equal(JSON.stringify(output).includes('secret'),false);
 assert.equal(output.matchedFailure,'ASSERTION');assert.throws(()=>suiteResult(config,{}));
});


test('Connector fixed login markers preserve exact assertion identity without private operands',async()=>{
 const {safeAcceptanceDiagnostics}=await import('./run-board-native-acceptance.mjs');
 const inspect=(message,file='board-connector-authority.spec.ts',line=34)=>safeAcceptanceDiagnostics('e2e/board-connector-existing-runtime.config.ts',{suites:[{specs:[{file,line:19,tests:[{results:[{status:'failed',errors:[{message,location:{file,line},stack:'PRIVATE'}]}]}]}]}]}).firstFailure;
 for(const [line,marker] of [[34,'C06_LOGIN_HTTP_OK'],[36,'C06_LOGIN_FIXTURE_ACTOR'],[37,'C06_LOGIN_SESSION_TOKEN']]){
  const output=inspect(`Error: ${marker}\nExpected: PRIVATE_ACTOR\nReceived: PRIVATE_TOKEN`,undefined,line);
  assert.equal(output.assertionId,marker);assert.equal(output.matchedFailure,'ASSERTION');assert.equal(output.ambiguous,false);assert(!JSON.stringify(output).includes('PRIVATE'));
 }
 assert.equal(inspect('C06_LOGIN_HTTP_OK\nC06_LOGIN_SESSION_TOKEN').ambiguous,true);
 assert.equal(inspect('C06_LOGIN_HTTP_OK\nC06_LOGIN_SESSION_TOKEN').assertionId,undefined);
 for(const value of ['PRIVATE C06_LOGIN_HTTP_OK','C06_LOGIN_HTTP_OK PRIVATE','C06_LOGIN_UNKNOWN','x'.repeat(8193)+'\nC06_LOGIN_HTTP_OK'])assert.equal(inspect(value).assertionId,undefined);
 assert.equal(inspect('C06_LOGIN_HTTP_OK','board-connector-history.spec.ts').assertionId,undefined);
 for(const line of [undefined,19,35,38])assert.equal(inspect('C06_LOGIN_SESSION_TOKEN',undefined,line).matchedFailure,'UNKNOWN');
 assert.equal(inspect('Expected: PRIVATE\nC06_LOGIN_HTTP_OK').matchedFailure,'UNKNOWN');
 assert.equal(inspect('C06_LOGIN_SESSION_TOKEN',undefined,34).matchedFailure,'UNKNOWN');
 let reads=0;const report={suites:[{specs:[{file:'board-connector-authority.spec.ts',line:19,tests:[{results:[{status:'failed',errors:[Object.defineProperty({},'message',{get(){reads++;return 'C06_LOGIN_HTTP_OK';}})]}]}]}]}]};
 assert.equal(safeAcceptanceDiagnostics('e2e/board-connector-existing-runtime.config.ts',report).firstFailure.assertionId,undefined);assert.equal(reads,0);
 const hostile=new Proxy({},{getOwnPropertyDescriptor(target,key){if(key==='message')throw new Error('PRIVATE');return Reflect.getOwnPropertyDescriptor(target,key);}});
 report.suites[0].specs[0].tests[0].results[0].errors=[hostile];
 assert.equal(safeAcceptanceDiagnostics('e2e/board-connector-existing-runtime.config.ts',report).firstFailure.matchedFailure,'UNKNOWN');
});
