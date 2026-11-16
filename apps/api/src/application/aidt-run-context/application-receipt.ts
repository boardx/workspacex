import type { AidtContextApplicationEvent, AidtContextReceipt } from '@repo/contracts/aidt-run-context';
/** Reduce durable observations without manufacturing a dispatch or changing journal order. */
export function reduceAidtApplication(runId:string,events:readonly AidtContextApplicationEvent[]):AidtContextReceipt['application'] {
 // execute-run's server-owned ID is `${runId}:${stepSeqBase}`. Observation
 // arrival order cannot identify the current attempt after a delayed HTTP callback.
 let current:{id:string;ordinal:number}|null=null;
 for(const row of events){
  const prefix=`${runId}:`,suffix=row.event.attemptId.startsWith(prefix)?row.event.attemptId.slice(prefix.length):"";
  const ordinal=/^[1-9][0-9]*$/.test(suffix)?Number(suffix):NaN;
  if(row.runId!==runId||!Number.isSafeInteger(ordinal))return {state:"unknown",attemptId:null,assembledContextHash:null,assembledAt:null,messageDispatchedAt:null,checkpointResumedAt:null,inheritedMessageDispatchAttemptId:null};
  if(current===null||ordinal>current.ordinal)current={id:row.event.attemptId,ordinal};
 }
 const attempt=current?.id??null,local=events.filter(e=>e.event.attemptId===attempt),assembled=local.find(e=>e.event.kind==='assembled'),dispatched=local.find(e=>e.event.kind==='message-dispatch-observed'),resumed=local.find(e=>e.event.kind==='checkpoint-resume-observed'),failed=local.find(e=>e.event.kind==='failed');
 return {state:resumed?'checkpoint-resume-observed':dispatched?'message-dispatch-observed':failed?assembled?'unknown':'failed-before-dispatch':assembled?'assembled':'prepared',attemptId:attempt,assembledContextHash:assembled&&assembled.event.kind==='assembled'?assembled.event.assembledContextHash:resumed&&resumed.event.kind==='checkpoint-resume-observed'?resumed.event.assembledContextHash:null,assembledAt:assembled?.occurredAt??null,messageDispatchedAt:dispatched?.occurredAt??null,checkpointResumedAt:resumed?.occurredAt??null,inheritedMessageDispatchAttemptId:resumed&&resumed.event.kind==='checkpoint-resume-observed'?resumed.event.inheritedMessageDispatchAttemptId:null};
}
