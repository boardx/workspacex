import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,openSync,closeSync,readdirSync,copyFileSync,realpathSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {join,resolve,basename,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const suites={
  'e2e/board-r01-existing-runtime.config.ts':{count:8,files:['board-r01-native-matrix.spec.ts'],projects:['r01-native-1440','r01-native-390'],titles:['N01-N02 auxiliary pan held release cancellation and Select pointer wheel preserve the document','N05 transformed multi drawing erase preserves image Sticky Shape and locked ink in one durable history transaction',... [.5,2].map(zoom=>`N03-N04 native Sticky Shape Drawing multi transform at zoom ${zoom} and nonzero pan preserves atomic history`)]},
  'e2e/board-connector-existing-runtime.config.ts':{count:7,files:['board-connector-authority.spec.ts','board-connector-copy-defaults.spec.ts','board-connector-history.spec.ts','board-connector-independent-process.spec.ts','board-connector-interchange.spec.ts']},
  'e2e/board-files-completion.config.ts':{count:6,files:['board-files-boundaries.spec.ts','board-files-filenames.spec.ts','board-files-placement.spec.ts','board-files-retry.spec.ts']},
  'e2e/board-peer-existing-runtime.config.ts':{metadata:'apps/web/e2e/support/r08/r08-native-suite.json'},
};

export function suiteDefinition(config,root=resolve(process.cwd())){
  const descriptor=suites[config];assert(descriptor);
  if(!descriptor.metadata)return descriptor;
  const metadata=JSON.parse(readFileSync(join(root,descriptor.metadata),'utf8'));
  assert.equal(metadata.config,config);assert.equal(metadata.files.length,2);assert.equal(new Set(metadata.files).size,2);
  assert(metadata.files.every(file=>/^board-[a-z-]+\.spec\.ts$/.test(file)));
  assert.equal(metadata.projects.length,2);assert.equal(new Set(metadata.projects.map(project=>project.name)).size,2);
  assert.deepEqual(metadata.projects.map(project=>project.viewport.width).sort((a,b)=>a-b),[390,1440]);
  assert(metadata.projects.every(project=>typeof project.name==='string'&&project.name.length>0));
  assert(Array.isArray(metadata.requiredScreenshotNames)&&metadata.requiredScreenshotNames.length>0);
  assert.equal(new Set(metadata.requiredScreenshotNames).size,metadata.requiredScreenshotNames.length);
  assert(metadata.requiredScreenshotNames.every(name=>/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)));
  return{files:metadata.files,projects:metadata.projects.map(project=>project.name),screenshots:metadata.projects.flatMap(project=>metadata.requiredScreenshotNames.map(name=>`${name}-${project.viewport.width}.png`)),count:metadata.files.length*metadata.projects.length};
}

export function acceptanceCommand(args){
  assert.equal(args[0],'--');const command=args.slice(1);
  assert.deepEqual(command.slice(0,6),['pnpm','--filter','web','exec','playwright','test']);
  assert.equal(command[6],'--config');
  assert(Object.hasOwn(suites,command[7]));
  assert.equal(command.length,8,'Only the complete signed suite may run');return command;
}

export function suiteResult(config,report,root=resolve(process.cwd())){
  const {files,projects,titles,count:expected}=suiteDefinition(config,root),seen=new Set(),pairs=[];let count=0;
  const visit=suite=>{for(const spec of suite.specs??[]){seen.add(basename(spec.file));assert.equal(spec.ok,true);for(const test of spec.tests??[]){count++;if(projects)pairs.push(`${basename(spec.file)}:${titles?`${spec.title}:`:''}${test.projectName}`);assert.equal(test.status,'expected');assert.equal(test.results.length,1);assert.equal(test.results[0].status,'passed');}}for(const nested of suite.suites??[])visit(nested);};
  for(const suite of report.suites??[])visit(suite);
  assert.deepEqual([...seen].sort(),[...files].sort());assert.equal(count,expected);
  if(projects)assert.deepEqual(pairs.sort(),files.flatMap(file=>titles?titles.flatMap(title=>projects.map(project=>`${file}:${title}:${project}`)):projects.map(project=>`${file}:${project}`)).sort());
  assert.equal(report.errors?.length??0,0);assert.equal(report.stats?.expected,expected);
  for(const key of ['unexpected','flaky','skipped'])assert.equal(report.stats?.[key],0);
  return{expected,unexpected:0,flaky:0,skipped:0};
}

// Classify the first private reporter failure with fixed public categories only.
// A matched signature is a diagnostic hint, never an acceptance proof.
export function safeAcceptanceDiagnostics(config,report,root=resolve(process.cwd())){
  const definition=suiteDefinition(config,root);
  const signatures={
    MANIFEST_INPUTS:['Explicit source-bound runtime manifest and verifier are mandatory'],
    VERIFIER_PIN:['Unreviewed runtime verifier cannot satisfy acceptance','Verifier changed while checking runtime'],
    MANIFEST_SOURCE:['Runtime producer must attest readiness','Exact runtime source must be explicitly requested','Runtime startup attestation changed during acceptance','Case startup manifest changed','Case runtime process/source identity changed','Startup manifest changed while checking runtime'],
    BROWSER_EXECUTABLE:["Executable doesn't exist at",'browserType.launch:'],
  };
  const classify=(error,status)=>{
    const message=typeof error?.message==='string'?error.message:'';
    const matches=Object.entries(signatures).filter(([,values])=>values.some(value=>message.includes(value))).map(([key])=>key);
    if(matches.length>0)return{matchedFailure:matches.length===1?matches[0]:'UNKNOWN',ambiguous:matches.length>1};
    if(status==='timedOut'||error?.name==='TimeoutError')return{matchedFailure:'TIMEOUT',ambiguous:false};
    if(error?.code==='ERR_ASSERTION'||message.includes('expect('))return{matchedFailure:'ASSERTION',ambiguous:false};
    return{matchedFailure:'UNKNOWN',ambiguous:false};
  };
  const result=(phase,caseIndex,status,errors)=>({phase,caseIndex,resultStatus:status,errorCount:Array.isArray(errors)?Math.min(errors.length,4096):0,...classify(errors?.[0],status)});
  let ordinal=0,first=null;
  const visit=suite=>{
    for(const spec of suite.specs??[])for(const test of spec.tests??[]){
      const index=ordinal++;
      if(first)continue;
      const failed=(test.results??[]).find(item=>['failed','timedOut','interrupted'].includes(item.status));
      if(failed){
        const known=definition.files.includes(basename(spec.file??''))&&index<definition.count;
        first=result('CASE',known?index:null,failed.status,failed.errors?.length?failed.errors:failed.error?[failed.error]:[]);
      }
    }
    for(const nested of suite.suites??[])visit(nested);
  };
  for(const suite of report.suites??[])visit(suite);
  if(!first&&report.errors?.length)first=result('REPORT',null,null,report.errors);
  return{version:1,firstFailure:first};
}

export function suitePresent(config,tracked,root=resolve(process.cwd())){
  const paths=new Set(tracked),descriptor=suites[config];
  if(descriptor.metadata&&!paths.has(descriptor.metadata)){
    assert(!paths.has(`apps/web/${config}`)&&!tracked.some(path=>path.startsWith('apps/web/e2e/support/r08/')||/^apps\/web\/e2e\/board-(peer-|sync-lifecycle)/.test(path)),'Partial R08 suite requires its metadata');return false;
  }
  const {files}=suiteDefinition(config,root),hasConfig=paths.has(`apps/web/${config}`),present=files.filter(file=>paths.has(`apps/web/e2e/${file}`));
  if(descriptor.metadata)assert(hasConfig,'R08 metadata requires its complete config');
  if(!hasConfig&&present.length===0)return false;
  assert(hasConfig,'Existing native specs require their complete config');assert.equal(present.length,files.length,'Partial native suite is not an absent feature');return true;
}

export function runtimeExitProof(code,signal,wasAlive){assert.equal(wasAlive,true,'Runtime exited before owned stop');assert.equal(signal,null);assert.equal(code,0);}
export function runtimeSpawnState(child){const state={failed:false};child.on('error',()=>{state.failed=true;});return state;}
export function sameRuntimeProof(before,after){assert.deepEqual(after,before);}

export function safeStartupDiagnostics(log){
  const known=['native-migrate','native-fullstack-seed','native-web-build'];
  const failed=known.filter(name=>log.includes(`${name} failed; inspect private log`));
  return{matchedFailure:failed.length===1?failed[0]:'UNKNOWN',ambiguous:failed.length>1};
}

export function startupFailureProof(diagnostics,data,head){
  const receipt=diagnostics.readStartupFailure(data);
  if(receipt.sourceHead!==null)assert.equal(receipt.sourceHead,head);
  return receipt;
}

export function screenshotProof(config,screenshots,root=resolve(process.cwd())){
  for(const item of screenshots){assert(Number.isInteger(item.bytes)&&item.bytes>24);assert(Number.isInteger(item.width)&&item.width>0);assert(Number.isInteger(item.height)&&item.height>0);}
  assert(screenshots.length>0);assert(screenshots.some(item=>item.width===1440));assert(screenshots.some(item=>item.width===390));
  if(config.includes('files'))for(const name of ['R09-placement-1440.png','R09-reloaded-1440.png','R09-placement-390.png','R09-reloaded-390.png','R09-real-backend-503.png','R09-real-backend-retry-refreshed.png',...Array.from({length:7},(_,index)=>`R09-native-download-${index}.png`)])assert(screenshots.some(item=>item.originalName===name),`Missing required screenshot: ${name}`);
  if(config.includes('peer'))for(const name of suiteDefinition(config,root).screenshots)assert(screenshots.some(item=>item.originalName===name),`Missing required screenshot: ${name}`);
  if(config.includes('r01'))for(const width of [1440,390])for(const name of [...['middle','right'].flatMap(button=>['release','escape','pointercancel','blur'].map(finish=>`${button}-${finish}-held`)),...['Control','Meta'].flatMap(modifier=>[`pointer-zoom-${modifier}`,`pointer-zoom-out-${modifier}`]),'multi-erase-held','multi-erase-protected','multi-erase-refreshed',...['move','rotate','scale'].flatMap(gesture=>[`multi-${gesture}-cancel-held`,`multi-${gesture}-commit-held`,`multi-${gesture}-canceled`,`multi-${gesture}-refreshed`])])assert.equal(screenshots.filter(item=>item.originalName===`${name}-${width}.png`).length,name.startsWith('multi-')&&!name.startsWith('multi-erase-')?2:1,`Missing or duplicate required screenshot: ${name}-${width}.png`);
}

export function r01ResultSummary(results,head){
  assert.equal(results.length,8,'Every R01 case requires its final receipt');
  const definition=suiteDefinition('e2e/board-r01-existing-runtime.config.ts'),pairs=[];
  for(const result of results){assert.equal(result.source,head);assert.equal(result.beforeProof?.identity?.head,head);assert.equal(result.afterProof?.identity?.head,head);assert.deepEqual(result.afterProof,result.beforeProof);for(const key of ['manifestHash','verifierHash','selectorHash'])assert.match(result.beforeProof[key],/^[a-f0-9]{64}$/);assert.equal(result.status,'functional-cases-passed');assert.equal(result.completed,false);assert.equal(typeof result.cleanupPending,'boolean');assert.equal(result.hardwareTrackpad,'unverified');pairs.push(`${result.testIdentity.title}:${result.testIdentity.project}`);}
  assert.deepEqual(pairs.sort(),definition.titles.flatMap(title=>definition.projects.map(project=>`${title}:${project}`)).sort());
  return{functionalCasesPassed:8,completed:false,cleanupPending:results.some(result=>result.cleanupPending),hardwareTrackpad:'unverified',requiredSuiteComplete:false};
}

export function r01ReportReceipts(report,artifacts,head){
 const directory=realpathSync(artifacts),receipts=[],paths=new Set();
 const visit=suite=>{for(const spec of suite.specs??[])for(const test of spec.tests??[])for(const result of test.results??[]){const attachments=(result.attachments??[]).filter(item=>item.name==='r01-result');assert.equal(attachments.length,1);const path=realpathSync(attachments[0].path),inside=relative(directory,path);assert(inside&&!inside.startsWith('..')&&!isAbsolute(inside),'Foreign R01 receipt path');assert.equal(basename(path),'r01-result.json');assert(!paths.has(path),'Duplicate R01 receipt path');paths.add(path);const receipt=JSON.parse(readFileSync(path,'utf8'));assert.deepEqual(receipt.testIdentity,{title:spec.title,project:test.projectName});assert.equal(receipt.source,head);receipts.push(receipt);}for(const nested of suite.suites??[])visit(nested);};
 visit(report);return receipts;
}

export async function run(args=process.argv.slice(2)){
  const command=acceptanceCommand(args),root=resolve(process.cwd());
  const toolRoot=process.env.NATIVE_POSTGRES_TOOL_ROOT,publicRoot=process.env.BOARD_NATIVE_EVIDENCE;
  assert(toolRoot&&publicRoot,'Explicit native toolchain and safe evidence paths required');
  assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),'');
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const support=join(root,'apps/web/e2e/support/native-runtime');
  const authority=await import(pathToFileURL(join(support,'runtime-attestation.mjs')).href);
  const isPeer=command[7].includes('peer'),isR01=command[7].includes('r01'),privateRoot=join('/private/tmp',`wsx-native-ci-${randomUUID()}`),safeRoot=join(publicRoot,isR01?'r01':isPeer?'sync':command[7].includes('files')?'files':'connectors');
  assert(!existsSync(privateRoot)&&!existsSync(safeRoot));mkdirSync(safeRoot,{recursive:true,mode:0o700});
  const sourceFiles=authority.listRuntimeSourceFiles(root);
  if(!suitePresent(command[7],sourceFiles)){
    writeFileSync(join(safeRoot,'receipt.json'),JSON.stringify({sourceHead:head,status:'ABSENT',existingSpecsSkipped:0,actualRuntimeExecution:false,requiredSuiteComplete:false},null,2),{mode:0o600,flag:'wx'});return;
  }
  mkdirSync(privateRoot,{mode:0o700});
  const data=join(privateRoot,'data'),manifestInput=join(privateRoot,'source-manifest.json');
  writeFileSync(manifestInput,JSON.stringify({root,head,sourceFiles}),{mode:0o600,flag:'wx'});
  const build=join(root,'apps/web/.next-fullstack-e2e');assert(!existsSync(build),'Owned fresh production build required');
  const privateLog=join(privateRoot,'execution.log'),fd=openSync(privateLog,'wx',0o600);
  let runtime,runtimeState,exitCode=null,failureReason=null,cleanupCompleted=false,runtimeExit=null,phase='PREPARE',adapter,adapterState,runtimeBefore;
  const cleanupFailures=[];
  const execute=async(executable,args,environment=process.env)=>{
    const child=spawn(executable,args,{cwd:root,env:environment,stdio:['ignore',fd,fd]});
    const [code,signal]=await once(child,'exit');assert.equal(signal,null);assert.equal(code,0);
  };
  try{
    if(isPeer)adapter=await import(pathToFileURL(join(root,'apps/web/e2e/support/r08/r08-native-adapter.mjs')).href);
    await execute(process.execPath,[join(support,'wsx-board-native-runtime-prepare.mjs'),'--root',root,'--head',head,'--data-dir',data,'--source-manifest',manifestInput,'--postgres-tool-root',toolRoot,...(command[7].includes('files')?['--file-storage-attestation']:[]),...(adapter?adapter.prepareArguments({proxyPort:36322}):[])]);
    phase='STARTUP';
    runtime=spawn(process.execPath,[join(support,'wsx-board-native-runtime-start.mjs'),join(data,'native-runtime-plan.json')],{cwd:root,env:process.env,stdio:['ignore',fd,fd]});
    runtimeState=runtimeSpawnState(runtime);
    const manifestPath=join(data,'runtime-manifest.json');
    const deadline=Date.now()+30*60_000;
    for(;;){
      if(runtimeState.failed||runtime.exitCode!==null||runtime.signalCode!==null)throw new Error('NATIVE_RUNTIME_START_FAILED');
      if(existsSync(manifestPath)&&JSON.parse(readFileSync(manifestPath,'utf8')).ready===true)break;
      assert(Date.now()<deadline,'Native startup deadline exceeded');await new Promise(resolve=>setTimeout(resolve,1000));
    }
    const manifest=JSON.parse(readFileSync(manifestPath,'utf8')),environment=JSON.parse(readFileSync(join(data,'native-runner-environment.json'),'utf8'));
    const proof=()=>({manifestDigest:createHash('sha256').update(readFileSync(manifestPath)).digest('hex'),identity:authority.verifyRuntimeManifest({manifestPath,root,base:manifest.webBase,origin:manifest.apiBase,sourceFiles})});
    runtimeBefore={proof,before:proof()};
    if(adapter){const adapterRoot=join(data,'r08-acceptance');mkdirSync(adapterRoot,{mode:0o700});adapterState=await adapter.prepareEnvironment({root,privateRoot:adapterRoot,planPath:join(data,'native-runtime-plan.json'),manifestPath});assert.equal(adapterState.proxyPort,36322);}
    phase='ACCEPTANCE';
    const report=join(privateRoot,'playwright-report.json');
    const env={...process.env,...environment,...adapterState?.environment,BOARD_CONNECTOR_WEB_URL:manifest.webBase,BOARD_CONNECTOR_RUNTIME_MANIFEST:manifestPath,BOARD_CONNECTOR_RUNTIME_VERIFIER:join(support,'runtime-attestation.mjs'),...(isR01?{BOARD_R01_WEB_URL:manifest.webBase,BOARD_R01_OUTPUT_DIR:join(privateRoot,'artifacts'),BOARD_ACCEPTANCE_SHA:head}:{}),BOARD_FILES_REPORT_PATH:report,PLAYWRIGHT_JSON_OUTPUT_NAME:report};
    const test=spawn(command[0],[...command.slice(1),'--reporter=json','--output',join(privateRoot,'artifacts')],{cwd:root,env,stdio:['ignore',fd,fd]});
    const [code,signal]=await once(test,'exit');exitCode=code;assert.equal(signal,null);assert.equal(typeof code,'number');
    if(code!==0)failureReason='ACCEPTANCE_FAILED';
    const parsed=JSON.parse(readFileSync(report,'utf8'));
    writeFileSync(join(safeRoot,'acceptance-diagnostics.json'),JSON.stringify({sourceHead:head,...safeAcceptanceDiagnostics(command[7],parsed,root)},null,2),{mode:0o600,flag:'wx'});
    const statistics=Object.fromEntries(['expected','unexpected','flaky','skipped'].map(key=>[key,Number.isInteger(parsed.stats?.[key])?parsed.stats[key]:null]));
    writeFileSync(join(safeRoot,'statistics.json'),JSON.stringify({sourceHead:head,stats:statistics,errors:parsed.errors?.length??0,exitCode,requiredSuiteComplete:false},null,2),{mode:0o600,flag:'wx'});
    const screenshots=[];
    function collect(directory){if(!existsSync(directory))return;for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())collect(path);else if(entry.isFile()&&entry.name.endsWith('.png')){const bytes=readFileSync(path),name=`${screenshots.length}-${entry.name}`;assert(bytes.length>24);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');copyFileSync(path,join(safeRoot,name));screenshots.push({name,originalName:entry.name,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}}}
    collect(join(privateRoot,'artifacts'));writeFileSync(join(safeRoot,'screenshots.json'),JSON.stringify(screenshots,null,2),{mode:0o600,flag:'wx'});
    suiteResult(command[7],parsed);screenshotProof(command[7],screenshots);
    if(isR01){const summary=r01ResultSummary(r01ReportReceipts(parsed,join(privateRoot,'artifacts'),head),head);writeFileSync(join(safeRoot,'r01-summary.json'),JSON.stringify(summary,null,2),{mode:0o600,flag:'wx'});assert.equal(summary.cleanupPending,false,'R01 owned boards remain preserved pending authorized cleanup');}
  }catch{failureReason=failureReason??'NATIVE_RUN_FAILED';}
  finally{
    if(adapterState)try{await adapterState.verifyEnd();}catch{cleanupFailures.push('R08_END_RUNTIME_PROOF_FAILED');}
    if(runtimeBefore)try{sameRuntimeProof(runtimeBefore.before,runtimeBefore.proof());}catch{cleanupFailures.push('END_RUNTIME_IDENTITY_CHANGED');}
    try{
      if(runtime){
        assert.equal(runtimeState.failed,false,'Owned runtime spawn failed');
        const wasAlive=runtime.exitCode===null&&runtime.signalCode===null;
        if(wasAlive){const stopped=once(runtime,'exit');runtime.kill('SIGTERM');let timer;try{const result=await Promise.race([stopped,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('OWNED_STOP_TIMEOUT')),30_000);})]);runtimeExit={code:result[0],signal:result[1],wasAlive};}finally{clearTimeout(timer);}}
        else runtimeExit={code:runtime.exitCode,signal:runtime.signalCode,wasAlive};
        runtimeExitProof(runtimeExit.code,runtimeExit.signal,runtimeExit.wasAlive);
      }
    }catch{cleanupFailures.push('OWNED_RUNTIME_STOP_FAILED');}
    for(const port of [36317,36320,36321,...(isPeer?[36322]:[])])try{
      const check=spawn('lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN'],{stdio:['ignore',fd,fd]});const [code,signal]=await once(check,'exit');assert.equal(signal,null);assert.equal(code,1,`Owned runtime port not released: ${port}`);
    }catch{cleanupFailures.push(`OWNED_PORT_NOT_RELEASED:${port}`);}
    try{
      const sameHead=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();assert.equal(sameHead,head);
      assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),'');
      if(cleanupFailures.length===0&&existsSync(build))rmSync(build,{recursive:true});
    }catch{cleanupFailures.push('OWNED_BUILD_OR_SOURCE_CHECK_FAILED');}
    cleanupCompleted=cleanupFailures.length===0;if(!cleanupCompleted)failureReason=failureReason??'OWNED_CLEANUP_FAILED';
    closeSync(fd);
    let startupDiagnostics={matchedFailure:'UNKNOWN',ambiguous:false},startupFailure=null;
    if(phase==='STARTUP')try{startupDiagnostics=safeStartupDiagnostics(readFileSync(privateLog,'utf8'));}catch{ /* Private diagnostics are optional, never a passing gate. */ }
    if((phase==='PREPARE'||phase==='STARTUP')&&existsSync(join(data,'native-startup-failure.json')))try{
      const diagnostics=await import(pathToFileURL(join(support,'native-startup-receipt.mjs')).href);
      startupFailure=startupFailureProof(diagnostics,data,head);
    }catch{startupFailure=null;cleanupFailures.push('STARTUP_FAILURE_RECEIPT_INVALID');cleanupCompleted=false;failureReason=failureReason??'STARTUP_FAILURE_RECEIPT_INVALID';}
    writeFileSync(join(safeRoot,'receipt.json'),JSON.stringify({sourceHead:head,phase,startupDiagnostics,startupFailure,exitCode,runtimeExit,failureReason,cleanupCompleted,cleanupFailures,privateEvidenceRetained:true,requiredSuiteComplete:false,visuallyAccepted:false},null,2),{mode:0o600,flag:'wx'});
  }
  if(failureReason)throw new Error(failureReason);
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname))await run();
