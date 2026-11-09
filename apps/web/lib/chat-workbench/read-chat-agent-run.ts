import {getAgentRun} from "@/lib/agent-run";
/** Historical/recovery reads are observations; only the active chat attempt announces failure. */
export function readChatAgentRun(runId:string,bearer?:string,signal?:AbortSignal){return getAgentRun(runId,bearer,signal,{notifyCredit:false});}
