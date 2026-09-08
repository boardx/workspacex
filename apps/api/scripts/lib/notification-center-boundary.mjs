import ts from 'typescript';
export const NOTIFICATION_CENTER_PATH='src/infrastructure/notifications/pg-notification-center.ts';
export const NOTIFYING_RUN_EVENT_BUS_PATH='src/infrastructure/notifications/notifying-run-event-bus.ts';
function parse(path,source){
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true),methods=new Map();
 const compact=n=>n?.getText(ast).replace(/\s+/g,'');
 const calls=node=>{const found=[];function walk(n){if(ts.isCallExpression(n))found.push(n);ts.forEachChild(n,walk);}if(node)walk(node);return found;};
 function walk(n){if(ts.isMethodDeclaration(n))methods.set(n.name.getText(ast),n);ts.forEachChild(n,walk);}walk(ast);
 const queries=name=>calls(methods.get(name)).filter(n=>ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='query');
 return {methods,compact,queries};
}
/** 通知中心：一行只有收件人本人能读/标已读（`user_id=$1`），组织维度再收一层（`org_id IS NULL OR org_id=$2`）。 */
export function checkNotificationCenter(source){
 const {methods,compact,queries}=parse(NOTIFICATION_CENTER_PATH,source),errors=[];
 if([...methods.keys()].sort().join(',')!=='list,markRead,publish')errors.push('unexpected notification entry point');
 if(!compact(methods.get('markRead'))?.includes('NotificationReadInput.parse(raw)'))errors.push('strict request schema required');
 let total=0;
 for(const name of ['list','markRead']){
  for(const q of queries(name)){
   total++;const literal=q.arguments[0];
   if(!ts.isStringLiteralLike(literal)){errors.push('dynamic SQL forbidden');continue;}
   const sql=literal.text.replace(/\s+/g,' ');
   if(!sql.includes('FROM user_notifications')&&!sql.includes('UPDATE user_notifications'))errors.push('unexpected table');
   if(!sql.includes('WHERE user_id=$1 AND (org_id IS NULL OR org_id=$2)'))errors.push('exact recipient/tenant binding required');
   if(!compact(q.arguments[1])?.startsWith('[viewer.userId,viewer.orgId'))errors.push('recipient must be the authenticated viewer');
   if(name==='list'&&sql.startsWith('SELECT')&&sql.includes('SELECT id,kind')&&!sql.includes('LIMIT $3'))errors.push('bounded projection required');
  }
 }
 if(total!==3)errors.push('unexpected SQL surface');
 const publish=queries('publish');
 if(publish.length!==1||!compact(publish[0].arguments[0])?.includes('INSERTINTOuser_notifications(')||!compact(publish[0].arguments[0])?.includes('ONCONFLICTDONOTHING'))errors.push('publish must be a single idempotent insert');
 if(!compact(methods.get('publish'))?.includes('if(input.orgId)awaitthis.db.withTenant(input.orgId,run);elseawaitthis.db.withoutTenant(run);'))errors.push('cross-org rows only for org-less personal notices');
 return errors;
}
/** run 状态推送：只解析这次 run 自己的发起人（human 作者），从不把消息正文放进通知。 */
export function checkNotifyingRunEventBus(source){
 const {methods,compact,queries}=parse(NOTIFYING_RUN_EVENT_BUS_PATH,source),errors=[];
 if([...methods.keys()].sort().join(',')!=='notify,publish,subscribe')errors.push('unexpected event bus surface');
 if(!methods.get('notify')?.modifiers?.some(m=>m.kind===ts.SyntaxKind.PrivateKeyword))errors.push('notify must stay private');
 const q=queries('notify');
 if(q.length!==1){errors.push('exactly one run lookup');return errors;}
 const literal=q[0].arguments[0];
 if(!ts.isStringLiteralLike(literal)){errors.push('dynamic SQL forbidden');return errors;}
 const sql=literal.text.replace(/\s+/g,' ');
 if(!sql.startsWith('SELECT m.author_id, r.thread_id, t.title FROM agent_runs r'))errors.push('lookup must project author, thread and title only');
 if(!sql.includes("WHERE r.org_id=$1 AND r.id=$2 AND m.author_kind='human'"))errors.push('lookup must bind this run and its human author');
 if(compact(q[0].arguments[1])!=='[orgId,runId]')errors.push('exact run binding required');
 if(!compact(methods.get('notify'))?.includes('userId:row.author_id,kind:"task"'))errors.push('recipient must be the run author');
 if(/m\.body|r\.output|text/.test(sql))errors.push('message content must not enter a notification');
 return errors;
}
