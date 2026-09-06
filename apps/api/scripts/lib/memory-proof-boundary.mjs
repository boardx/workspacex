import ts from 'typescript';
export const MEMORY_PROOF_PATH='src/infrastructure/agent-run/pg-standard-memory-proof.ts';
/** Facts-only SQL followed by the existing visibility projection; never a waiver. */
export function checkMemoryProof(source){
 const ast=ts.createSourceFile(MEMORY_PROOF_PATH,source,ts.ScriptTarget.Latest,true);
 const errors=[],calls=[],conditions=[],returns=[];let methods=0;
 const compact=n=>n.getText(ast).replace(/\s+/g,'');
 function walk(n){
  if(ts.isMethodDeclaration(n)){methods++;if(n.name.getText(ast)!=='check')errors.push('unexpected method');}
  if(ts.isCallExpression(n))calls.push(n);
  if(ts.isIfStatement(n)&&ts.isThrowStatement(n.thenStatement))conditions.push(n);
  if(ts.isReturnStatement(n))returns.push(n);
  ts.forEachChild(n,walk);
 }walk(ast);
 if(methods!==1)errors.push('one checked method required');
 const call=name=>calls.find(n=>compact(n.expression)===name);
 const authority=call('this.authority.check'),query=calls.filter(n=>ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='query');
 const denial=conditions.find(n=>compact(n.expression)==='!decision.allowed');
 if(!authority||!denial||denial.pos<authority.pos||query.length!==1||query[0].pos<denial.pos)errors.push('authority must refuse before the sole facts query');
 if(!call('this.db.withTenant')||compact(call('this.db.withTenant').arguments[0])!=='orgId')errors.push('tenant transaction required');
 if(query.length===1){
  const q=query[0],literal=q.arguments[0];
  const expected='SELECT r.thread_id,r.input_message_id,m.author_id,m.author_kind FROM agent_runs r JOIN chat_messages m ON m.org_id=r.org_id AND m.id=r.input_message_id WHERE r.org_id=$1 AND r.id=$2';
  if(!literal||!ts.isStringLiteralLike(literal)||literal.text.replace(/\s+/g,' ').trim()!==expected||compact(q.arguments[1])!=='[orgId,runId]')errors.push('facts query and real tenant/run bindings required');
 }
 for(const expected of ['!run||run.author_kind!==\'human\'||run.author_id!==input.userId','write.sourceMessageId!==run.input_message_id']){
  if(!conditions.some(n=>compact(n.expression)===expected))errors.push('trusted author/source binding missing');
 }
 const visible=call('getThread');
 const current=call('resolveVisibility');
 if(!current||compact(current.arguments[1])!=='{orgId,userId:run.author_id,threadId:run.thread_id,projectId:currentThread.projectId}'||!conditions.some(n=>compact(n.expression)==="currentVisibility.kind!=='allow'"))errors.push('current requester membership/visibility required');
 if(!visible||compact(visible.arguments[1])!=='{orgId,userId:run.author_id,threadId:source.threadId,projectId:facts.projectId}')errors.push('existing current visibility read required');
 if(!call('thread.messages.some')||!call('visible.push'))errors.push('visible message projection required');
 const outward=calls.find(n=>compact(n.expression)==='MemoryProofOutput.parse');
 if(!outward||!compact(outward.arguments[0]).includes('scope:{orgId:input.orgId,userId:run.author_id},visible'))errors.push('bounded trusted output required');
 if(returns.some(n=>n.expression&&compact(n.expression)!=='MemoryProofOutput.parse({scope:{orgId:input.orgId,userId:run.author_id},visible,...(sourceRef?{sourceRef}:{})})'&&!compact(n.expression).startsWith('this.db.withTenant(')))errors.push('unexpected raw output');
 return errors;
}
