import ts from 'typescript';
export const MCP_EXECUTION_BOUNDARIES=new Set(['src/infrastructure/mcp/pg-mcp-review-snapshots.ts','src/infrastructure/mcp/pg-mcp-execution-snapshot.ts','src/infrastructure/mcp/pg-mcp-isolation.ts','src/infrastructure/mcp/mcp-inflight-control.ts']);
export function checkMcpExecutionBoundary(path,source){
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true),nodes=[],errors=[];
 const text=n=>n?.getText(ast).replace(/\s+/g,'');
 const walk=n=>{nodes.push(n);ts.forEachChild(n,walk);};walk(ast);
 const calls=nodes.filter(ts.isCallExpression),ifs=nodes.filter(ts.isIfStatement),methods=nodes.filter(ts.isMethodDeclaration);
 const call=(name,arg)=>calls.find(n=>text(n.expression)===name&&(arg===undefined||text(n.arguments[0])===arg));
 const condition=expr=>ifs.find(n=>text(n.expression)===expr&&(ts.isThrowStatement(n.thenStatement)||ts.isContinueStatement(n.thenStatement)));
 const method=name=>methods.find(n=>text(n.name)===name);
 if(calls.some(n=>text(n.expression)?.endsWith('.withoutTenant')))errors.push('unscoped transaction');
 const allowed=new Set(path.includes('review-snapshots')?['mcp_review_snapshots','mcp_servers','mcp_tools','mcp_server_secrets']:['agent_runs','agent_versions','agents','chat_messages','chat_threads','mcp_servers','mcp_server_secrets','mcp_review_snapshots','mcp_run_snapshots','mcp_tool_executions','mcp_isolation_requests','mcp_isolation_calls']);
 for(const n of calls.filter(n=>text(n.expression)?.endsWith('.query'))){
  const sql=n.arguments[0],args=text(n.arguments[1]);
  if(!sql||!ts.isStringLiteralLike(sql)){errors.push('dynamic SQL');continue;}
  for(const match of sql.text.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi))if(match[1].toUpperCase()!=='LATERAL'&&!allowed.has(match[1]))errors.push('unexpected table');
  if(!/org_id/.test(sql.text)||!args||!/^\[(orgId|org|context\.orgId)(,|\])/.test(args))errors.push('query tenant binding');
 }
 if(path.includes('mcp-inflight-control')){
  if(!calls.some(n=>text(n.expression)==='controller.abort')||!ifs.some(n=>text(n.expression)==="!row||row.status!=='pending'||row.isolation_request_id"))errors.push('durable request must abort');
  if(!source.includes("AND isolation_request_id IS NOT NULL AND status='unconfirmed' AND local_stop_ack_at IS NULL"))errors.push('ack only stopped unconfirmed receipt');
  if(!source.includes('await pending;')||!source.includes('clearTimeout(timer)'))errors.push('monitor cleanup');
 }else if(path.includes('pg-mcp-isolation')){
  if(!condition("!member||member.orgRole!=='admin'"))errors.push('real admin gate');
  for(const name of ['isolate','status'])if(!text(method(name)?.body)?.startsWith('{awaitthis.authorize(orgId,userId);'))errors.push('admin before isolation reads');
  if(!source.includes("count(*) FILTER(WHERE e.local_stop_ack_at IS NOT NULL)")||!source.includes("count(*) FILTER(WHERE e.status='pending')"))errors.push('actual ack counts');
  if(!source.includes("AND status='pending' AND (deadline_at IS NULL OR deadline_at<now())"))errors.push('uncertain expiry recovery');
  const cancel=calls.find(n=>n.arguments[0]&&ts.isStringLiteralLike(n.arguments[0])&&n.arguments[0].text.startsWith('UPDATE mcp_tool_executions SET isolation_request_id='));
  if(!cancel||cancel.arguments[0].text!=="UPDATE mcp_tool_executions SET isolation_request_id=$3 WHERE org_id=$1 AND server_id=$2 AND status='pending'"||text(cancel.arguments[1])!=='[orgId,input.serverId,requestId]')errors.push('server scoped cancellation');
  let parent=cancel?.parent;while(parent&&!ts.isIfStatement(parent))parent=parent.parent;
  if(!parent||text(parent.expression)!=="input.mode==='interrupt'"||parent.thenStatement.pos>cancel.pos||parent.thenStatement.end<cancel.end)errors.push('drain must not interrupt');
  const linked=calls.find(n=>n.arguments[0]&&ts.isStringLiteralLike(n.arguments[0])&&n.arguments[0].text.startsWith('INSERT INTO mcp_isolation_calls'));
  if(!linked||!linked.arguments[0].text.endsWith("WHERE org_id=$1 AND server_id=$2 AND status='pending'")||text(linked.arguments[1])!=='[orgId,input.serverId,requestId]')errors.push('server scoped tracking');
 }else if(path.includes('review-snapshots')){
  if(methods.length!==1||!method('review'))errors.push('unexpected review surface');
  const member=call('this.identity.findOrgMembership','reviewerId'),denied=condition("!member||!['lead','admin'].includes(member.orgRole)");
  const transaction=call('this.db.withTenant','orgId'),review=call('reviewMcpServer');
  if(!member||!denied||!transaction||!review||!(member.pos<denied.pos&&denied.pos<transaction.pos&&transaction.pos<review.pos))errors.push('real membership before review transaction');
  const reviewArgs=text(review?.arguments[1]);
  if(reviewArgs!=="{orgId,server:{serverId:input.serverId,registeredByActorId:server.registered_by_actor_id,reviewStatus:server.review_status},reviewerId,verdict:input.verdict,reason:input.reason,authScope:input.authScope,grantedToolIds:input.grantedToolIds}")errors.push('review use case identity and scope');
  if(!source.includes('WHERE org_id=$1 AND server_id=$2 FOR UPDATE'))errors.push('review server lock');
 }else{
  const publicNames=methods.filter(n=>!n.modifiers?.some(m=>m.kind===ts.SyntaxKind.PrivateKeyword)).map(n=>text(n.name)).sort();
  if(JSON.stringify(publicNames)!==JSON.stringify(['capture','invoke','isolate','isolationStatus','resolve','review']))errors.push('unexpected public disclosure');
  for(const name of ['capture','resolve'])if(!text(method(name)?.body)?.startsWith('{returnthis.admitted(context,async()=>{'))errors.push('admission wrapper');
  if(!call('this.reader.withSnapshot','context')||!condition('!state?.active||state.cancelRequested||!state.leaseValid||state.attemptId!==context.attemptId'))errors.push('lease and cancellation boundary');
  if(!condition("(awaitresolveVisibility(this.visibility,{orgId:org,userId:facts.requester_id,threadId:facts.thread_id,projectId:facts.project_id})).kind!=='allow'"))errors.push('requester visibility');
  if(!ifs.some(n=>text(n.expression)==='!organization||isLocalOrg(organization.kind)'&&ts.isReturnStatement(n.thenStatement)&&text(n.thenStatement.expression)==='[]'))errors.push('egress boundary');
  if(!source.includes("m.id=r.input_message_id AND m.thread_id=r.thread_id AND m.author_kind='human'")||!source.includes('v.id=r.agent_version_id AND v.agent_id=r.agent_id'))errors.push('fixed run and human requester');
  const gate=condition('Buffer.byteLength(JSON.stringify(input.toolArgs))>L.maxArgsBytes||!(awaitthis.authority.check(context)).allowed');
  const execute=call('execution');
  if(!nodes.some(n=>ts.isVariableDeclaration(n)&&text(n.name)==='execution'&&text(n.initializer)==="frozen.credentialRevision?this.broker?.execute:this.execute"))errors.push('credential route');
  if(!condition('!(awaitthis.authority.check(context)).allowed')||!gate||!execute||gate.pos>execute.pos)errors.push('actual shared dispatch authority');
  const rechecks=calls.filter(n=>text(n.expression)==='this.recheck'&&text(n.arguments[0])==='context'&&text(n.arguments[1])==='frozen');
  if(rechecks.length!==2||!execute||rechecks[0].pos>execute.pos||rechecks[1].pos<execute.pos||text(rechecks[0].arguments[2])!==undefined||text(rechecks[1].arguments[2])!=='true')errors.push('dispatch and result reauthorization');
  if(text(execute?.arguments[2])!=='{signal:control.signal,deadlineAt,receipt:{orgId:org,runId,toolCallId:input.toolCallId,attemptId:input.attemptId,leaseEpoch:input.leaseEpoch}}'||!call('acknowledgeMcpLocalStop'))errors.push('transport cancellation and acknowledgement');
  if(!condition("!frozen||!current||frozen.reviewId!==current.reviewId||frozen.endpoint!==current.endpoint||frozen.tool.schemaFingerprint!==current.tool.schemaFingerprint||(frozen.credentialRevision??null)!==(current.credentialRevision??null)"))errors.push('current revocation check');
  if(!condition('record.authScopeSet!==server.auth_scope')||!source.includes('tool.authScope!==record.authScopeSet||!whitelistEntryGrants(entry)'))errors.push('approved scope and whitelist');
  if(!condition("prior.tool_name!==input.toolName||prior.args_digest!==hash||prior.status!=='succeeded'"))errors.push('unknown outcome replay refusal');
  if(!source.includes('(server.credential_configured&&!this.broker)||server.involves_customer_data')||!source.includes('review.credential_revision!==server.credential_revision'))errors.push('credential revision and broker gate');
 }
 return errors;
}
