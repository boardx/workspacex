/**
 * 对话读取的存储端口。定义在这里，由 `infrastructure` 实现。
 *
 * `findThreadFacts` / `findMessages` 的拆分与 F03 的 `findItemFacts` / `findItemBody`
 * 同一个理由：判定要用的属性和**正文**分两次取，正文只在判定说「可以」之后才进内存。
 * 一次性把正文取到手，再靠后面每条分支记得别返回它，就是把「有没有泄露」
 * 押在未来每一次修改上。
 */
import type { OrgId } from "../../domain/org-id";
import type { MessageFacts, ThreadFacts } from "../../domain/chat/thread-visibility";
import type { Guarded } from "../security/permission-filter";

/** 一条消息的正文与作者信息。**只在判定通过后取**。 */
export interface ChatMessageRow extends MessageFacts {
  readonly authorKind: "human" | "agent";
  readonly authorId: string;
  readonly agentId: string | null;
  readonly body: string;
}

/** 只用于展示的线程字段。判定用不到它们，所以判定也不该拿到它们。 */
export interface ThreadPresentation {
  readonly phase: "onsite" | "research";
  readonly lastActivityAt: string;
  readonly version: number;
}

export interface ChatRepository {
  /** 判定所需的线程属性，不含正文。线程不存在返回 null。 */
  findThreadFacts(orgId: OrgId, threadId: string): Promise<ThreadFacts | null>;

  /** 展示字段。**判定通过后**才调用。 */
  findThreadPresentation(orgId: OrgId, threadId: string): Promise<ThreadPresentation | null>;

  /**
   * 该线程的全部消息（含正文），包在 `Guarded` 里。
   *
   * 不是裸数组：`Guarded<T>` 里取不出 `T`，除非交出一个 `PermissionDecision`
   * （`discloseDecided`）。于是「忘了判权」从一个疏漏变成一个类型错误——
   * 这正是 F02 的守卫读路径存在的理由，对话正文没有理由例外。
   */
  findMessages(orgId: OrgId, threadId: string): Promise<Guarded<ChatMessageRow[]> | null>;

  /**
   * 消息条数。COUNT，不是取回列表再数长度——
   * 「只返计数、不返正文」最可靠的实现方式是正文根本没被加载（I-8）。
   */
  countMessages(orgId: OrgId, threadId: string): Promise<number>;
}

export const CHAT_REPOSITORY = Symbol("ChatRepository");
