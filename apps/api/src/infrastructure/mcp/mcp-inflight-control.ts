import {MCP_EXECUTION_LIMITS as L} from '@repo/contracts/mcp-execution-snapshot';
import type {DatabasePort} from '../../application/ports/database.port';
import type {OrgId} from '../../domain/org-id';
/** Poll only this claimed receipt. A failed control read stops the local transport conservatively. */
export async function mcpInflightControl(db:DatabasePort,orgId:OrgId,runId:string,toolCallId:string,deadlineAt=Date.now()+L.deadlineMs){
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,finished=false;
 let pending:Promise<void>=Promise.resolve();
 const poll=async()=>{
  try{const row=await db.withTenant(orgId,async s=>(await s.query<{isolation_request_id:string|null;status:string}>('SELECT isolation_request_id,status FROM mcp_tool_executions WHERE org_id=$1 AND run_id=$2 AND tool_call_id=$3',[orgId,runId,toolCallId])).rows[0]);
   if(!row||row.status!=='pending'||row.isolation_request_id)controller.abort();
  }catch{controller.abort();}
 };
 const deadline=setTimeout(()=>controller.abort(),Math.max(0,deadlineAt-Date.now()));
 const next=()=>{if(!finished&&!controller.signal.aborted)timer=setTimeout(()=>{pending=poll().then(next);},L.cancelPollMs);};
 await poll();next();
 return {signal:controller.signal,async close(){finished=true;clearTimeout(deadline);if(timer)clearTimeout(timer);await pending;}};
}
/** Called only after the execution promise settles, including awaited Worker termination. */
export async function acknowledgeMcpLocalStop(db:DatabasePort,orgId:OrgId,runId:string,toolCallId:string){
 await db.withTenant(orgId,s=>s.query("UPDATE mcp_tool_executions SET local_stop_ack_at=now(),finished_at=COALESCE(finished_at,now()) WHERE org_id=$1 AND run_id=$2 AND tool_call_id=$3 AND isolation_request_id IS NOT NULL AND status='unconfirmed' AND local_stop_ack_at IS NULL",[orgId,runId,toolCallId]));
}
