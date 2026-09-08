import { z } from "zod";
export const QueuedMessage = z.object({ id: z.string().uuid(), clientRequestId: z.string().uuid(), text: z.string(), agentId: z.string(), status: z.enum(["pending", "dispatched", "cancelled", "failed"]), runId: z.string().nullable(), createdAt: z.string(), error: z.string().nullable() }).strict();
export const EnqueueMessage = z.object({ clientRequestId: z.string().uuid(), text: z.string().trim().min(1).max(100000), agentId: z.string().min(1).nullable().optional() }).strict();
/** 还在排队（`pending`）的消息可以改正文；已派发/撤回的不可改（服务端 409）。 */
export const UpdateQueuedMessage = z.object({ text: z.string().trim().min(1).max(100000) }).strict();
export const operations = {
  list: { method: "GET", path: "/chat/threads/:threadId/queued-messages", out: z.object({ items: z.array(QueuedMessage) }).strict() },
  enqueue: { method: "POST", path: "/chat/threads/:threadId/queued-messages", in: EnqueueMessage, out: QueuedMessage },
  cancel: { method: "DELETE", path: "/chat/threads/:threadId/queued-messages/:id", out: QueuedMessage },
  update: { method: "PATCH", path: "/chat/threads/:threadId/queued-messages/:id", in: UpdateQueuedMessage, out: QueuedMessage },
};
export type QueuedMessage = z.infer<typeof QueuedMessage>;
