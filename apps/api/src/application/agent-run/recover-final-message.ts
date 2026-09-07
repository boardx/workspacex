import type { AgentRunStore } from "./ports";
import type { OrgId } from "../../domain/org-id";
/** Restore the original streamed identity from durable events, never from a new
 * recovery attempt id or a guessed assistant name. Safe to repeat after a crash. */
export async function recoverFinalMessageIdentity(runs:Pick<AgentRunStore,"readExecutionEvents"|"appendExecutionEvent">,
  orgId:OrgId,runId:string,finalMessageId:string|undefined):Promise<void>{
  if(!finalMessageId||!runs.readExecutionEvents||!runs.appendExecutionEvent)return;
  let cursor=-1;
  let match:{attemptId:string;messageId:string}|undefined;
  const finalized=new Set<string>();
  while(true){
    const page=await runs.readExecutionEvents(orgId,runId,cursor);
    if(!page.length)break;
    for(const event of page){
      if(event.kind==="final_message")finalized.add(event.messageId);
      if(event.kind==="text_delta"&&event.attemptId&&event.messageId===`${event.attemptId}:${finalMessageId}`)
        match={attemptId:event.attemptId,messageId:event.messageId};
    }
    const next=page.at(-1)!.seq;if(next<=cursor)throw new Error("execution journal cursor did not advance");cursor=next;
    if(page.length<1000)break;
  }
  if(match&&!finalized.has(match.messageId))await runs.appendExecutionEvent(orgId,runId,{kind:"final_message",...match});
}
