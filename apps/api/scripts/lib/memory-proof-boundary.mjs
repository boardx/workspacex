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
 const binding=call('withAuthorizedStandardToolRun');
 if(!binding||binding.arguments.slice(0,5).map(compact).join(',')!=='this.db,this.authority,this.visibility,runId,{...input,toolArgs:args}')errors.push('shared trusted run binding required');
 if(calls.some(n=>ts.isPropertyAccessExpression(n.expression)&&['query','withoutTenant','withTenant'].includes(n.expression.name.text)))errors.push('memory must not duplicate trusted run SQL');
 if(!conditions.some(n=>compact(n.expression)==='write.sourceMessageId!==run.inputMessageId'))errors.push('current input source binding missing');
 const visible=call('getThread');
 if(!visible||compact(visible.arguments[1])!=='{orgId,userId:run.userId,threadId:source.threadId,projectId:facts.projectId}')errors.push('existing current visibility read required');
 if(!call('thread.messages.some')||!call('visible.push'))errors.push('visible message projection required');
 const outward=calls.find(n=>compact(n.expression)==='MemoryProofOutput.parse');
 if(!outward||!compact(outward.arguments[0]).includes('scope:{orgId:input.orgId,userId:run.userId},visible'))errors.push('bounded trusted output required');
 if(returns.some(n=>n.expression&&compact(n.expression)!=='MemoryProofOutput.parse({scope:{orgId:input.orgId,userId:run.userId},visible,...(sourceRef?{sourceRef}:{})})'&&!compact(n.expression).startsWith('withAuthorizedStandardToolRun(')))errors.push('unexpected raw output');
 return errors;
}
