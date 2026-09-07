import type { QueuedMessage } from "@repo/contracts/thread-message-queue";
import type { OrgId } from "../../domain/org-id";
export const THREAD_MESSAGE_QUEUE = Symbol("ThreadMessageQueue");
export class QueueNotVisibleError extends Error {}
export class QueueConflictError extends Error {}
export interface ThreadMessageQueuePort {
  list(orgId:OrgId,userId:string,threadId:string):Promise<{items:QueuedMessage[]}>;
  enqueue(orgId:OrgId,userId:string,threadId:string,input:{clientRequestId:string;text:string;agentId?:string|null}):Promise<QueuedMessage>;
  cancel(orgId:OrgId,userId:string,threadId:string,id:string):Promise<QueuedMessage>;
}
