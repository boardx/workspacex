/** Pure human project channel. Approved A+B review SHA 33b1c4e981a2b3dcea248f7b0f9b84c40b7afb76e61c63afa62e3f1368679c21.
 * This is independent of AI Chat: accepting a message never queues an AgentRun.
 */
import { z } from "zod";

export const Sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const StageReference = z.object({
  stageId: z.number().int().min(1).max(6),
  revision: z.number().int().positive().optional(),
}).strict();
export const MemberMessage = z.object({
  id: z.string().uuid(), projectId: z.string().min(1), sequence: Sequence.positive(),
  authorId: z.string().min(1), clientMessageId: z.string().uuid(),
  text: z.string().min(1).max(4000), threadRootId: z.string().uuid().nullable(),
  stageReference: StageReference.nullable(), createdAt: z.string().datetime(),
}).strict();
export type MemberMessage = z.infer<typeof MemberMessage>;
export const ThreadUpdate = z.object({
  rootMessageId: z.string().uuid(), replyCount: z.number().int().nonnegative(),
  lastSequence: Sequence.positive(),
}).strict();
export const ReadOnlyReason = z.enum(["archived", "org-disabled", "role"]);
const Access = { canWrite: z.boolean(), readOnlyReason: ReadOnlyReason.nullable() };
const PageInput = z.object({
  projectId: z.string().min(1), beforeSequence: Sequence.optional(),
  afterSequence: Sequence.optional(), limit: z.number().int().min(1).max(100).default(30),
}).strict().refine(x => x.beforeSequence === undefined || x.afterSequence === undefined,
  { message: "beforeSequence and afterSequence are mutually exclusive" });
const PageOutput = {
  items: z.array(MemberMessage), nextBeforeSequence: Sequence.nullable(),
  nextAfterSequence: Sequence, latestSequence: Sequence, ...Access,
};
export const Reason = z.enum([
  "MODULE_DISABLED", "NOT_FOUND", "READ_ONLY_ARCHIVED", "READ_ONLY_ORG_DISABLED", "READ_ONLY_ROLE",
  "INVALID_INPUT", "MESSAGE_TOO_LARGE", "IDEMPOTENCY_CONFLICT", "THREAD_ROOT_INVALID", "DEPENDENCY_UNAVAILABLE",
]);
const errors = Reason.options;
export const operations = {
  listMessages: {
    method: "GET", path: "/projects/:projectId/member-chat/messages",
    in: PageInput,
    /** History returns root messages. afterSequence returns ALL new messages, including replies;
     * apply threadUpdates to older roots. Persist nextAfterSequence only after applying this page.
     * It equals the last item if more pages remain; otherwise it reaches latestSequence.
     */
    out: z.object({ ...PageOutput, threadUpdates: z.array(ThreadUpdate) }).strict(), err: errors,
  },
  postMessage: {
    method: "POST", path: "/projects/:projectId/member-chat/messages",
    in: z.object({
      projectId: z.string().min(1), clientMessageId: z.string().uuid().transform(value => value.toLowerCase()),
      text: z.string().trim().min(1).max(4000), threadRootId: z.string().uuid().transform(value => value.toLowerCase()).optional(),
      stageReference: StageReference.optional(),
    }).strict(),
    out: z.object({ message: MemberMessage, replayed: z.boolean() }).strict(), err: errors,
  },
  listReplies: {
    method: "GET", path: "/projects/:projectId/member-chat/messages/:threadRootId/replies",
    in: z.object({
      projectId: z.string().min(1), threadRootId: z.string().uuid(),
      beforeSequence: Sequence.optional(), afterSequence: Sequence.optional(),
      limit: z.number().int().min(1).max(100).default(30),
    }).strict().refine(x => x.beforeSequence === undefined || x.afterSequence === undefined,
      { message: "beforeSequence and afterSequence are mutually exclusive" }),
    out: z.object({ ...PageOutput, root: MemberMessage }).strict(), err: errors,
  },
} as const;
