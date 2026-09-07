import ts from 'typescript';
export const STANDARD_SCHEDULE_PATH='src/infrastructure/agent-run/pg-standard-schedule.ts';
export function checkStandardSchedule(source){
 const ast=ts.createSourceFile(STANDARD_SCHEDULE_PATH,source,ts.ScriptTarget.Latest,true),errors=[],methods=new Map();
 const compact=n=>n?.getText(ast).replace(/\s+/g,'');
 function visit(n){if(ts.isMethodDeclaration(n))methods.set(n.name.getText(ast),n);ts.forEachChild(n,visit);}visit(ast);
 const calls=(node)=>{const found=[];function scan(n){if(ts.isCallExpression(n))found.push(n);ts.forEachChild(n,scan);}if(node)scan(node);return found;};
 const call=(method,name)=>calls(methods.get(method)).find(n=>compact(n.expression)===name);
 const invoke=methods.get('invoke'),invokeText=compact(invoke);
 const required=["ScheduleToolRequest.parse(raw)","SCHEDULE_TOOL_SCHEMAS[input.toolName].parse(input.toolArgs)","withAuthorizedStandardToolRun(this.deps.db,this.deps.authority,this.deps.visibility,runId,{...input,toolArgs:args}","authorizeSubtaskParent(this.deps.visibility,{orgId:trusted.orgId,userId:trusted.userId,runId,write:input.toolName!=='wx_schedule_list'})","this.deps.db.withTenant(trusted.orgId","this.deps.provider.inTransaction(session"];
 if(!invoke||required.some(text=>!invokeText.includes(text)))errors.push('strict live tool authority and write-role boundary required');
 const outerReturns=invoke?.body?.statements.filter(ts.isReturnStatement)??[];
 if(outerReturns.length!==1||!compact(outerReturns[0].expression)?.startsWith('withAuthorizedStandardToolRun('))errors.push('request entry must return through authority callback');
 const authority=call('invoke','withAuthorizedStandardToolRun');
 const authorized=authority?.arguments.at(-1);
 if(!authorized||!ts.isArrowFunction(authorized)||!compact(authorized.body)?.startsWith('{awaitauthorizeSubtaskParent('))errors.push('write-role check must precede request helper dispatch');
 const dispatches=calls(methods.get('deliver')).filter(n=>compact(n.expression)==='this.deps.gateway.dispatch');
 if(dispatches.length!==1)errors.push('one gateway dispatch inside transaction only');
 for(const dispatch of dispatches){
  let parent=dispatch.parent;while(parent&&!ts.isArrowFunction(parent))parent=parent.parent;
  if(!parent||!ts.isCallExpression(parent.parent)||compact(parent.parent.expression)!=='this.deps.provider.inTransaction')errors.push('gateway dispatch must be inside actual bound transaction');
 }

 for(const name of ['create','list','cancel','item'])if(!methods.get(name)?.modifiers?.some(m=>m.kind===ts.SyntaxKind.PrivateKeyword))errors.push('request helpers must remain private');
 if([...methods.keys()].some(name=>!['invoke','item','list','create','cancel','deliver'].includes(name)))errors.push('unexpected public/helper route');
 const item=compact(methods.get('item'));
 if(!item?.includes("visible?.kind==='allow'?row.instruction.slice(0,SCHEDULE_LIMITS.maxSummaryChars):'任务当前不可访问'")||!call('item','resolveVisibility'))errors.push('list must recheck target visibility before instruction disclosure');
 const deliver=compact(methods.get('deliver'));
 for(const required of ["wake.parse(job.data)","orgId=toOrgId(data.orgId)","this.deps.db.withTenant(orgId", "this.deps.provider.inTransaction(s", "if(row.status!=='active')", "this.deps.gateway.dispatch({orgId,userId:row.user_id,threadId:row.thread_id,agentId:row.agent_id,instruction:row.instruction,occurrenceId:job.id})", "if(kick)this.deps.gateway.kick(orgId)"]){if(!deliver?.includes(required))errors.push('trusted durable delivery boundary required: '+required);}
 const expected={
 list:['[orgId,userId,input.cursor??null,SCHEDULE_LIMITS.pageSize+1]'],
 create:['[scope.orgId,scope.userId,input.idempotencyKey]','[scope.orgId,scope.userId]','[id,scope.orgId,scope.userId,scope.threadId,scope.agentId,input.instruction,input.idempotencyKey,digest]'],
 cancel:['[orgId,userId,input.scheduleId]','[orgId,userId,row.id]'],
 deliver:['[orgId,data.scheduleId]','[orgId,row.id,recurring?\'active\':\'completed\',job.id,accepted.runId]','[orgId,row.id,code,job.id]','[orgId,notification!.id,notification!.last_occurrence_id]'],
 };
 let count=0;
 for(const [method,node] of methods){
  const queries=calls(node).filter(n=>ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='query'&&n.arguments[0]?.getText(ast).includes('standard_schedules'));
  const params=queries.map(q=>compact(q.arguments[1]));
  if(JSON.stringify(params)!==JSON.stringify(expected[method]??[]))errors.push('exact tenant/owner bindings changed in '+method);
  for(const q of queries){
   count++;
   const literal=q.arguments[0];
   if(!ts.isStringLiteralLike(literal)){errors.push('dynamic schedule SQL forbidden');continue;}
   const sql=literal.text.replace(/\s+/g,' ');
   if(sql.startsWith('INSERT')){if(!sql.includes('standard_schedules(id,org_id,user_id,thread_id,agent_id,instruction,idempotency_key,args_digest)'))errors.push('owned insert fields required');}
   else if(!sql.includes('WHERE org_id=$1')||(['create','list','cancel'].includes(method)&&!sql.includes('AND user_id=$2')))errors.push('every request query must bind current tenant and requester');
   if(method==='deliver'&&sql.startsWith('SELECT')&&!sql.endsWith('FOR UPDATE'))errors.push('delivery must lock before dispatch');
   if(method==='cancel'&&sql.startsWith('SELECT')&&!sql.endsWith('FOR UPDATE'))errors.push('cancel must share delivery lock');
  }
 }
 if(count!==10)errors.push('unexpected schedule query surface');
 return errors;
}
