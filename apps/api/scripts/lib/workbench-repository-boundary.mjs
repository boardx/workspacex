import ts from 'typescript';
const prefix='src/infrastructure/';
const specs={
 'agent-run/pg-native-output-staging.ts':['native_output_staging'],
 'agent-run/pg-native-session-owner.ts':['native_session_bindings','agent_runs'],
 'agent-run/pg-interjection-store.ts':['agent_run_interjections','agent_runs'],
 'agent-run/pg-parent-run-control.ts':['agent_runs','agent_run_steps'],
 'agent-run/pg-run-recovery.ts':['agent_runs','agent_run_steps'],
 'artifacts-steering/accept-message-artifact-run-launcher.ts':['agent_runs','agent_run_artifact_context'],
 'artifacts-steering/pg-artifact-continuation-reader.ts':['agent_run_artifact_context','agent_artifacts','agent_artifact_versions'],
 'artifacts-steering/register-run-artifacts.ts':['agent_run_artifact_context','agent_artifacts','agent_artifact_versions','agent_run_steps','chat_message_attachments','agent_runs','chat_messages'],
};
export const WORKBENCH_REPOSITORIES=new Set(Object.keys(specs).map(p=>prefix+p));
/** Structural regression checks for already-authorized internal producers/readers.
 * These are not runtime authorization and never grant a user access. */
export function checkWorkbenchRepository(path,source,read){
 const methodNames = {
 'pg-native-output-staging.ts':['stage','listFiles'],
 'pg-native-session-owner.ts':['authorized','crypt','provision','resolve','release','releaseForRun'],
 'pg-interjection-store.ts':['listPublic','requestPause','isCancelRequested','isPauseRequested','submit','pollForKernel','takePending','stageForKernel','takeStagedForKernel'],
 'pg-parent-run-control.ts':['readCancellation','withSnapshot'], 'pg-run-recovery.ts':['tick','diagnostic'],
 'accept-message-artifact-run-launcher.ts':['launch'], 'pg-artifact-continuation-reader.ts':['prepare'], 'register-run-artifacts.ts':[],
 };
 const errors=[];const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
 const require=(text,pattern,label)=>{if(!pattern.test(text))errors.push(label);};
 const allowed=new Set(specs[path.slice(prefix.length)]);
 let queryCount=0;
 function visit(n){
  if(ts.isMethodDeclaration(n) && !methodNames[path.split('/').at(-1)].includes(n.name.getText(ast))) errors.push('new repository method requires review');
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)){
   if(n.expression.name.text==='withoutTenant')errors.push('unscoped tenant execution forbidden');
   if(n.expression.name.text==='query'){
    queryCount++;const arg=n.arguments[0];
    if(!arg||!ts.isStringLiteralLike(arg))errors.push('SQL must be static');
    else{
     const sql=arg.text.replace(/FOR UPDATE(?: OF \w+)?(?: SKIP LOCKED)?/gi,'');
     for(const [,table] of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi))if(!allowed.has(table))errors.push('unexpected table '+table);
     require(sql,/\borg_id\s*=\s*\$1\b|INSERT\s+INTO\s+\w+\s*\([^)]*\borg_id\b/i,'tenant SQL predicate missing');
     if(!n.arguments[1])errors.push('SQL tenant bindings missing');
    }
   }
  }ts.forEachChild(n,visit);
 }visit(ast);if(!queryCount)errors.push('boundary SQL disappeared');
 if(path.endsWith('pg-native-output-staging.ts')){
  const methods=[];function methodsIn(n){if(ts.isMethodDeclaration(n))methods.push(n);ts.forEachChild(n,methodsIn);}methodsIn(ast);
  const stage=methods.find(n=>n.name.getText(ast)==='stage');
  const calls=[];let refusal=-1;
  function scanStage(n){
   if(ts.isCallExpression(n))calls.push(n);
   if(ts.isIfStatement(n)&&n.expression.getText(ast)==='!decision.allowed'&&ts.isThrowStatement(n.thenStatement))refusal=n.getStart(ast);
   ts.forEachChild(n,scanStage);
  }
  if(stage)scanStage(stage);
  const position=expression=>calls.find(n=>n.expression.getText(ast)===expression)?.getStart(ast)??-1;
  const authority=position('this.authority.check'),resolve=position('this.owner.resolve'),readAt=position('this.files(bound).read'),collect=position('collectNativeOutputs');
  if(!(authority>=0&&refusal>authority&&resolve>refusal&&readAt>resolve&&collect>readAt))errors.push('staging requires real authority denial before bound read and collection');
  require(stage?.getText(ast)??'',/this\.authority\.check\(\{\.\.\.context,toolName:NATIVE_ARTIFACT_TOOL,toolArgs:input\}\)/,'publish authority must bind actual arguments');
  require(stage?.getText(ast)??'',/this\.owner\.resolve\(context\.bindingId,context\)/,'publish session must bind trusted context');
  const list=methods.find(n=>n.name.getText(ast)==='listFiles');
  require(list?.getText(ast)??'',/this\.db\.withTenant\(orgId/,'internal output read requires tenant');
  require(list?.getText(ast)??'',/WHERE org_id=\$1 AND run_id=\$2/,'internal output read requires run');
  require(list?.getText(ast)??'',/\[orgId,runId\]/,'internal output read must bind tenant and run parameters');
  for(const call of calls.filter(n=>ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='query')){
   const sql=call.arguments[0];if(!sql||!ts.isStringLiteralLike(sql))continue;
   const values=call.arguments[1];
   if(!values||!ts.isArrayLiteralExpression(values)){errors.push('staging SQL binding must be explicit');continue;}
   const bindings=values.elements.map(n=>n.getText(ast));
   const offset=/^INSERT/i.test(sql.text)?1:0;
   if(bindings[offset]!=='context.orgId'||bindings[offset+1]!=='context.parentRunId')errors.push('staging SQL must bind actual tenant and parent run');
   if(!/^INSERT/i.test(sql.text)&&!/WHERE org_id=\$1 AND run_id=\$2/.test(sql.text))errors.push('staging query requires tenant/run predicate');
  }
  const controller=read('src/interface/controllers/native-output-staging.controller.ts');
  require(controller,/timingSafeEqual\(expected,actual\)/,'internal stage requires credential comparison');
  require(controller,/return await this\.staging\.stage/,'controller must invoke staging boundary');
  if(/\.listFiles\s*\(/.test(controller))errors.push('listFiles must not be exposed by controller');
  const execute=read('src/application/agent-run/execute-run.ts');
  require(execute,/nativeOutputs!\.listFiles\(orgId, run\.runId\)/,'output read must use executor claimed run');
  const recovery=read('src/infrastructure/agent-run/pg-run-recovery.ts');
  require(recovery,/await withRunLease\(/,'recovery output read requires lease fencing');
  require(recovery,/nativeOutputs!\.listFiles\(orgId,run\.id\)/,'recovery output read must use claimed run');
 }
 if(path.endsWith('pg-native-session-owner.ts')){
  require(source,/this.authority.withSnapshot\(context/,'native binding requires existing authority reader');
  for(const term of ['!s.active','s.cancelRequested','!s.leaseValid','s.attemptId!==context.attemptId'])if(!source.includes(term))errors.push('native authority check missing '+term);
  require(source,/return this.authorized\(context/,'native resolve must authorize');
  require(source,/const row=await this.authorized\(context/,'native provision must authorize');
  require(source,/ON CONFLICT\(org_id,run_id\) DO NOTHING/,'native provisioning slot must be unique');
  require(source,/row.status!=='ready'\|\|Number\(row.expires_at\)<=Date.now\(\)/,'expired binding must fail closed');
  require(source,/cipher.setAAD\(aad\)/,'native encrypted token requires bound AAD');
  require(source,/await this.transport.destroy/,'native release requires remote confirmation');
 }
 if(path.endsWith('pg-interjection-store.ts')){
  const c=read('src/interface/controllers/agent-run.controller.ts');
  require(c,/await this\.run\(principal,runId\);\s*return \{items:await this\.interjections\.listPublic/,'public interjections must authorize parent first');
  require(source,/WHERE i\.org_id=\$1 AND i\.run_id=\$2/,'public interjections need tenant and run binding');
 }
 if(path.endsWith('pg-parent-run-control.ts')){
  require(source,/FOR UPDATE OF r/,'authority row lock missing');
  require(source,/r\.lease_epoch=\$3 AND r\.lease_expires_at>now\(\)/,'authority lease check missing');
  require(source,/return check\(row \?/,'snapshot must pass through authority callback');
  require(source,/pending_permission_request_id !== input\.permissionRequestId/,'approval identity binding missing');
  require(source,/toolArgumentsDigest\(input\.toolArgs\) !== expected/,'approval argument binding missing');
  const authority=read('src/application/agent-run/tool-execution-authority.ts');
  for(const term of ['!snapshot.active','snapshot.cancelRequested','!snapshot.leaseValid','snapshot.attemptId !== input.attemptId','snapshot.explicitlyDenied','this.grants.hasGrant'])if(!authority.includes(term))errors.push('authority decision missing '+term);
 }
 if(path.endsWith('pg-run-recovery.ts')){
  require(source,/LIMIT 10 FOR UPDATE SKIP LOCKED/,'bounded recovery claim missing');
  require(source,/await withRunLease\(/,'recovery fencing missing');
  require(source,/reconcileExistingRun\(run.thread_id,run.remote_run_id,run.id,run.remote_thread_id\?\?undefined,run.runtime_profile\)/,'recovery must reconcile exact existing identity');
  if(/\.(?:complete|createRun|startRun)\(/.test(source))errors.push('recovery cannot submit new execution');
 }
 if(path.endsWith('accept-message-artifact-run-launcher.ts')){
  require(source,/await acceptHumanMessage\(this.deps, \{ orgId,userId: input.userId,threadId: input.threadId,/,'artifact launch must reauthorize through acceptance');
  const c=read('src/application/artifacts-steering/continue-artifact.ts');
  require(c,/discloseDecided\(guardedVersion, outcome.base\)/,'artifact source disclosure decision missing');
  require(c,/if \(!isDisclosed\(disclosedVersion\)\) throw new ArtifactNotVisibleError\(\)/,'artifact disclosure rejection missing');
 }
 if(path.endsWith('pg-artifact-continuation-reader.ts')){
  require(source,/v.version=c.based_on_version/,'immutable source version binding missing');
  require(source,/WHERE c.org_id=\$1 AND c.run_id=\$2/,'continuation run binding missing');
  const c=read('src/application/agent-run/execute-run.ts');
  require(c,/artifactContinuations\?\.prepare\(orgId, run.runId\)/,'source must belong to claimed run');
  require(c,/executeClaimed\(deps, input.orgId, outcome.run\)/,'claimed executor boundary missing');
 }
 if(path.endsWith('register-run-artifacts.ts')){
  require(source,/WHERE r.org_id=\$2 AND r.id=\$5/,'artifact source message tenant/run binding missing');
  require(source,/a.thread_id=\$3/,'artifact context thread binding missing');
  require(source,/thread_id=\$2 AND message_id=\$3 AND storage_ref=\$4/,'attachment writeback binding missing');
  require(source,/if \(!attachment\) throw/,'unbound artifact rejection missing');
  const c=read('src/infrastructure/agent-run/pg-agent-run-repository.ts');
  require(c,/await registerRunArtifacts\(s, \{ orgId, runId: input.runId, threadId: input.threadId, messageId,/,'artifact registration must use writeback transaction');
 }
 return errors;
}
