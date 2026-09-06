import ts from 'typescript';
const prefix='src/infrastructure/';
const specs={
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
  require(source,/reconcileExistingRun\(run.thread_id,run.remote_run_id,run.id\)/,'recovery must reconcile exact existing identity');
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
