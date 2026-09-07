import {acceptHumanMessage} from '../../application/chat/message-roundtrip';
import type {ScheduledRunGateway} from '../../application/agent-run/standard-schedule';
/** Existing chat command path, including current visibility and publication checks.
 * The composition root must give these repositories the scheduler's DATABASE_PORT. */
export class ScheduledChatRunGateway implements ScheduledRunGateway{
 constructor(private readonly deps:Parameters<typeof acceptHumanMessage>[0],readonly kick:ScheduledRunGateway['kick']){}
 async dispatch(input:Parameters<ScheduledRunGateway['dispatch']>[0]){
  const accepted=await acceptHumanMessage(this.deps,{orgId:input.orgId,userId:input.userId,threadId:input.threadId,agentId:input.agentId,text:input.instruction,clientMessageId:input.occurrenceId});
  return {runId:accepted.agentRunId};
 }
}
