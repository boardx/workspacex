import type { ExecutionEvent, ExecutionEventInput } from "@repo/contracts/execution-journal";
import { publicExecutionPayload } from "./public-execution-payload";
export interface LegacyStep { seq:number; kind:string; status:string; startedAt:string; endedAt:string; toolCallId:string|null; toolName:string|null; args:string|null; result:string|null }
/** Compatibility only: exact persisted timestamps and statuses, never reconstructed private reasoning. */
export function legacyExecutionEvents(runId:string,steps:readonly LegacyStep[],deltas:readonly {seq:number;text:string;createdAt:string}[],terminal?:{status:"succeeded"|"failed"|"cancelled";endedAt:string}):ExecutionEvent[] {
  const rows:{at:string;order:number;event:ExecutionEventInput}[]=[];
  for(const delta of deltas) rows.push({at:delta.createdAt,order:delta.seq,event:{kind:"text_delta",messageId:`legacy:${runId}:unclassified-text`,delta:delta.text}});
  for(const step of steps) {
    if(step.kind!=="tool_call" || !step.toolName) continue;
    const toolCallId=step.toolCallId ?? `legacy:${runId}:step:${step.seq}`;
    if(step.status==="in_progress") rows.push({at:step.startedAt,order:step.seq,event:{kind:"tool_start",toolCallId,toolName:step.toolName,args:publicExecutionPayload(step.args)}});
    else if(step.status==="succeeded" || step.status==="failed") rows.push({at:step.endedAt,order:step.seq,event:{kind:"tool_end",toolCallId,toolName:step.toolName,result:publicExecutionPayload(step.result),ok:step.status==="succeeded"}});
  }
  if(terminal) rows.push({at:terminal.endedAt,order:Number.MAX_SAFE_INTEGER,event:{kind:"status",status:terminal.status}});
  return rows.sort((a,b)=>a.at.localeCompare(b.at)||a.order-b.order).map((row,seq)=>({...row.event,runId,seq,emittedAt:row.at,source:"legacy" as const}));
}
