/** Pure evidence classification. Ambiguous concurrent fetches remain failures. */
export function classifyStickyCancellations({failedRequests,requestLifecycles,fetchObservations,navigationActions,commentsUrl}) {
 const expected=[],unexpected=[],usedSignals=new Set();
 for(const failed of failedRequests){
  const exact=failed.method==='GET'&&failed.url===commentsUrl&&failed.reason==='net::ERR_ABORTED';
  const action=exact&&navigationActions.find(a=>a.pending.includes(failed.id)&&failed.at>=a.start&&failed.at<=(a.end??a.start)+1000);
  if(action){expected.push({...failed,cause:`explicit-${action.name}`,attribution:'exact-node-request-id',action});continue;}
  const signals=exact?fetchObservations.map((o,index)=>({o,index})).filter(({o,index})=>!usedSignals.has(index)&&o.kind==='abort-rejection'&&o.url===failed.url&&o.method===failed.method&&o.aborted===true&&Number.isFinite(o.startedAt)&&o.startedAt<=o.at&&Math.abs(o.at-failed.at)<=1000&&o.abortStack?.includes('collaborative-thinking-editor')&&o.abortStack?.includes('commitHookEffect')):[];
  if(signals.length!==1){unexpected.push(failed);continue;}
  const {o:signal,index}=signals[0];
  const overlapping=requestLifecycles.filter(r=>r.url===signal.url&&r.method===signal.method&&Number.isFinite(r.startedAt)&&r.startedAt>0&&r.startedAt<=signal.at&&(r.endedAt??Infinity)>=signal.startedAt);
  if(overlapping.length!==1||overlapping[0].id!==failed.id){unexpected.push({...failed,ambiguity:{candidateRequestIds:overlapping.map(r=>r.id),signalCandidates:signals.length}});continue;}
  usedSignals.add(index);expected.push({...failed,cause:'observed-comments-effect-cleanup',attribution:'unique-lifecycle-overlap-not-exact-fetch-id',signal});
 }
 return{expected,unexpected};
}

/** CDP is authoritative for exact fetch/request identity; Node failures corroborate counts only. */
export function classifyConnectorCdpCancellations({failedRequests,cdpRequests,fetchObservations,commentsUrl}) {
 const expected=[],unexpected=[];
 const nodeComments=failedRequests.filter(r=>r.url===commentsUrl&&r.method==='GET'&&r.reason==='net::ERR_ABORTED');
 const cdpFailed=cdpRequests.filter(r=>r.failure);
 const commentsFailures=cdpFailed.filter(r=>r.url===commentsUrl&&r.method==='GET'&&r.failure.errorText==='net::ERR_ABORTED');
 const valid=[];
 for(const network of commentsFailures){
  const signals=fetchObservations.filter(o=>o.kind==='abort-rejection'&&o.fetchId===network.fetchId&&o.url===network.url&&o.method===network.method&&o.aborted===true&&o.abortStack?.includes('collaborative-thinking-editor')&&o.abortStack?.includes('commitHookEffect'));
  const sameId=cdpRequests.filter(r=>r.fetchId&&r.fetchId===network.fetchId);
  if(network.fetchId&&signals.length===1&&sameId.length===1&&network.failure.canceled===true)valid.push({network,signal:signals[0]});
 }
 const complete=nodeComments.length===commentsFailures.length&&valid.length===commentsFailures.length;
 if(complete)for(const v of valid)expected.push({cause:'observed-comments-effect-cleanup',attribution:'exact-cdp-request-id-and-fetch-id',requestId:v.network.requestId,fetchId:v.network.fetchId,url:v.network.url,method:v.network.method,failure:v.network.failure,signal:v.signal});
 for(const failed of failedRequests)if(!complete||!nodeComments.includes(failed))unexpected.push(failed);
 for(const network of cdpFailed)if(!complete||!commentsFailures.includes(network))unexpected.push({kind:'cdp-loading-failed',...network});
 return{expected,unexpected,nodeCorroboration:{nodeCommentFailures:nodeComments.length,cdpCommentFailures:commentsFailures.length,exactlyAttributed:valid.length,countMatched:complete}};
}
