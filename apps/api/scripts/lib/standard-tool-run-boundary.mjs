import ts from 'typescript';
export const STANDARD_TOOL_RUN_PATH='src/infrastructure/agent-run/with-authorized-standard-tool-run.ts';
export function checkStandardToolRun(source){
 const ast=ts.createSourceFile(STANDARD_TOOL_RUN_PATH,source,ts.ScriptTarget.Latest,true);
 const calls=[],conditions=[],returns=[],errors=[];
 const compact=n=>n?.getText(ast).replace(/\s+/g,'');
 function visit(n){
  if(ts.isCallExpression(n))calls.push(n);
  if(ts.isIfStatement(n)&&ts.isThrowStatement(n.thenStatement))conditions.push(n);
  if(ts.isReturnStatement(n))returns.push(n);
  if(ts.isFunctionDeclaration(n)&&n.name?.text!=='withAuthorizedStandardToolRun')errors.push('unexpected helper function');
  ts.forEachChild(n,visit);
 }visit(ast);
 const call=name=>calls.find(n=>compact(n.expression)===name);
 const authority=call('authority.check'),denial=conditions.find(n=>compact(n.expression)==='!decision.allowed');
 const queries=calls.filter(n=>ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='query');
 if(!authority||compact(authority.arguments[0])!=='{...input,orgId,parentRunId:runId}'||!denial||denial.pos<authority.pos||queries.length!==1||queries[0].pos<denial.pos)errors.push('real authority must refuse before sole facts SQL');
 if(compact(call('db.withTenant')?.arguments[0])!=='orgId'||call('db.withoutTenant'))errors.push('tenant transaction required');
 if(queries.length===1){
  const query=queries[0],literal=query.arguments[0];
  const sql='SELECT r.thread_id,r.input_message_id,m.author_id,m.author_kind FROM agent_runs r JOIN chat_messages m ON m.org_id=r.org_id AND m.id=r.input_message_id WHERE r.org_id=$1 AND r.id=$2';
  if(!literal||!ts.isStringLiteralLike(literal)||literal.text.replace(/\s+/g,' ').trim()!==sql||compact(query.arguments[1])!=='[orgId,runId]')errors.push('only tenant-bound requester facts allowed');
 }
 const author=conditions.find(n=>compact(n.expression)==="!run||run.author_kind!=='human'||run.author_id!==input.userId");
 const visibility=call('resolveVisibility'),visible=conditions.find(n=>compact(n.expression)==="currentVisibility.kind!=='allow'");
 const consume=call('consume');
 if(!author||!visibility||author.pos>visibility.pos||compact(visibility.arguments[1])!=='{orgId,userId:run.author_id,threadId:run.thread_id,projectId:currentThread.projectId}'||!visible||visible.pos<visibility.pos||!consume||consume.pos<visible.pos)errors.push('current requester visibility must precede consumption');
 if(compact(consume?.arguments[0])!=='{orgId,userId:run.author_id,threadId:run.thread_id,inputMessageId:run.input_message_id}')errors.push('trusted facts only consumption');
 if(returns.some(n=>!compact(n.expression)?.startsWith('db.withTenant(')&&compact(n.expression)!=='consume({orgId,userId:run.author_id,threadId:run.thread_id,inputMessageId:run.input_message_id})'))errors.push('unexpected raw return');
 return errors;
}
