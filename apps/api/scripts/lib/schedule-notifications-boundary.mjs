import ts from 'typescript';
export const SCHEDULE_NOTIFICATIONS_PATH='src/infrastructure/agent-run/pg-schedule-notifications.ts';
export function checkScheduleNotifications(source){
 const ast=ts.createSourceFile(SCHEDULE_NOTIFICATIONS_PATH,source,ts.ScriptTarget.Latest,true),errors=[],methods=new Map();
 const compact=n=>n?.getText(ast).replace(/\s+/g,'');
 const calls=node=>{const found=[];function walk(n){if(ts.isCallExpression(n))found.push(n);ts.forEachChild(n,walk);}if(node)walk(node);return found;};
 function walk(n){if(ts.isMethodDeclaration(n))methods.set(n.name.getText(ast),n);ts.forEachChild(n,walk);}walk(ast);
 if([...methods.keys()].sort().join(',')!=='list,markRead,publish,withViewer')errors.push('unexpected notification entry point');
 const viewer=methods.get('withViewer'),body=compact(viewer);
 if(!viewer?.modifiers?.some(m=>m.kind===ts.SyntaxKind.PrivateKeyword)||!body?.includes('returnthis.db.withTenant(viewer.orgId,asyncs=>{if(!awaitthis.identity.findOrgMembership(viewer.userId,viewer.orgId))thrownewScheduleNotificationForbiddenError();returnconsume(s);})'))errors.push('current membership must gate the private tenant callback');
 for(const method of ['list','markRead']){
  const node=methods.get(method),returns=node?.body?.statements.filter(ts.isReturnStatement)??[];
  if(returns.length!==1||!compact(returns[0].expression)?.startsWith('this.withViewer(viewer,asyncs=>'))errors.push('read/ack must return through membership callback');
 }
 if(!compact(methods.get('list'))?.includes('ScheduleNotificationListInput.parse(raw)')||!compact(methods.get('markRead'))?.includes('ScheduleNotificationReadInput.parse(raw)'))errors.push('strict request schemas required');
 const expected={publish:'[input.orgId,input.userId,input.scheduleId,input.factId,input.code]',list:'[viewer.orgId,viewer.userId,input.cursor??null,SCHEDULE_LIMITS.pageSize+1]',markRead:'[viewer.orgId,viewer.userId,input.factId]'};
 let total=0;
 for(const [name,node] of methods){
  for(const q of calls(node).filter(n=>ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='query')){
   total++;const literal=q.arguments[0];
   if(!ts.isStringLiteralLike(literal)){errors.push('dynamic SQL forbidden');continue;}
   const sql=literal.text.replace(/\s+/g,' ');
   if(!sql.includes('standard_schedules')||!sql.includes('WHERE org_id=$1 AND user_id=$2')||compact(q.arguments[1])!==expected[name])errors.push('exact tenant/recipient binding required');
   if(name==='publish'&&(!sql.includes("id=$3::uuid AND last_occurrence_id=$4::uuid AND failure_code=$5 AND status='failed'")||!sql.includes('COALESCE(notification_accepted_at,now())')))errors.push('publish must match existing immutable failure and retain receipt');
   if(name==='list'&&(!sql.startsWith('SELECT id,last_occurrence_id,failure_code,notification_accepted_at,notification_read_at FROM')||!sql.includes('notification_read_at IS NULL')||!sql.includes('ORDER BY id LIMIT $4')))errors.push('content-free bounded unread projection required');
   if(name==='markRead'&&(!sql.includes('last_occurrence_id=$3::uuid AND notification_accepted_at IS NOT NULL')||!sql.includes('COALESCE(notification_read_at,now())')))errors.push('ack must match accepted stable fact');
  }
 }
 if(total!==3)errors.push('unexpected SQL surface');
 const publisher=compact(methods.get('publish'));
 if(!publisher?.includes('awaitthis.db.withTenant(input.orgId')||!publisher?.includes('if(result.rows.length!==1)thrownewScheduleNotificationNotFoundError()'))errors.push('publish must await exact durable row before receipt');
 return errors;
}
