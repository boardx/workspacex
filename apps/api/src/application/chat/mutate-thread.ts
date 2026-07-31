/**
 * `mutateThread` —— 新建 / 改名 / 删除线程（F109 · uc-8-1 UC-5）。
 *
 * ## 并发不是可选项（V7 / E2）
 *
 * 改名与删除都带 `expectedVersion`。不匹配 ⇒ `VERSION_CHANGED`，**不静默覆盖**。
 * 实现方式是 `UPDATE ... WHERE version = $expected`——不是「先 SELECT 比一下再 UPDATE」：
 * 后者在两次语句之间有一个窗口，而那个窗口正是这条规则要关掉的东西。
 *
 * ## 删除是可追溯动作，所以 `impactScope` 不是装饰
 *
 * 契约要求删除返回影响范围。这里给的是**真实条数**（该线程有多少条消息随之消失），
 * 在删除**之前**读出来——删完再数只会得到 0，而一个恒为「影响 0 条」的影响范围
 * 比没有影响范围更糟：它看起来像已经验证过了。
 *
 * ## 🔴 [待人类裁决] 对话侧审计事件的类型码 —— **本文件唯一的一处**
 *
 * `provenance.ProvenanceEventType` 是**封闭枚举**，里面没有任何一档对应
 * 「线程被建/被改名/被删」；`ProvenanceEvent.target.kind` 也没有 `thread`。
 * 而 `chat` 契约的 `KNOWN_CONTRACT_GAPS.C_CHAT_5` 已经登记了这件事：
 * `queryChatAuditEvents.events[].type` 在对话侧是**开放字符串**，与 phase-00 的封闭枚举
 * 「是同一个查询面」这句话**没有任何机械保证**。
 *
 * ⇒ 本实现**不新建第二张审计表**（那是 X-2 明令禁止的），也**不修改契约**
 *   （契约由人改，ADR-020）。它把这个选择收敛成下面**一个具名常量**：
 *   裁决落地时改这一处，全仓跟着变；在此之前，读审计日志的人看到的
 *   `human-edited` **不是**「有人编辑了草稿」，而是「对话线程发生了生命周期变更」。
 *   **这是一处已知的语义错配，不是笔误。**
 *
 * 要人类回答的问题（二选一，不是「请评估」）：
 *   A. 给 `ProvenanceEventType` 补 `thread-created` / `thread-renamed` / `thread-deleted`，
 *      并给 `target.kind` 补 `thread`；
 *   B. 承认对话侧审计是另一个平面，明确它与 `queryProvenance` 的关系（推翻 X-2）。
 */
import type { OrgId } from "../../domain/org-id";
import type { ProvenanceWriter } from "../provenance/ports";
import type { ProvenanceEventKind } from "../provenance/ports";
import type { IdFactory } from "../artifact/ports";
import type { ChatRepository } from "./ports";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";
import { ThreadNotVisibleError } from "./get-thread";

/**
 * 🔴 见文件头。**改这一处即可**，别在调用点各自写一个。
 *
 * 三个动作故意用同一个码：在裁决之前，任何「create 用 A、delete 用 B」的分档
 * 都是实现者在替产品定义审计词汇表，而那正是 C_CHAT_5 要人类回答的问题本身。
 */
const CHAT_LIFECYCLE_AUDIT_TYPE: ProvenanceEventKind = "human-edited";

/** 越权尝试也必须留痕（V8）。这一档在枚举里语义**是对的**，不属于上面那个缺口。 */
const CHAT_REFUSAL_AUDIT_TYPE: ProvenanceEventKind = "unauthorized-attempt";

export class NoWriteRoleError extends Error {
  constructor() {
    super("no_write_role");
  }
}
export class VersionChangedError extends Error {
  constructor() {
    super("version_changed");
  }
}
export class TitleInvalidError extends Error {
  constructor() {
    super("title_invalid");
  }
}
export class ThreadArchivedReadonlyError extends Error {
  constructor() {
    super("thread_archived_readonly");
  }
}

export interface MutateThreadDeps extends ResolveVisibilityDeps {
  readonly chat: ChatRepository;
  readonly provenance: ProvenanceWriter;
  readonly artifactIds: IdFactory;
}

export interface MutateThreadInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly op: "create" | "rename" | "delete";
  readonly projectId: string | null;
  readonly threadId: string | null;
  readonly groupId: string | null;
  readonly title: string | null;
  readonly visibilityScope: string | null;
  readonly expectedVersion: number | null;
  readonly reason: string | null;
}

export interface MutateThreadResult {
  readonly threadId: string;
  readonly version: number;
  readonly auditEventId: string;
  readonly impactScope: string | null;
}

/** 标题规则的**唯一**一处。空白、纯空格、超长都是 `TITLE_INVALID`。 */
function normalizeTitle(raw: string | null): string {
  const t = (raw ?? "").trim();
  if (t.length === 0 || t.length > 200) throw new TitleInvalidError();
  return t;
}

export async function mutateThread(
  deps: MutateThreadDeps,
  input: MutateThreadInput,
): Promise<MutateThreadResult> {
  if (input.op === "create") return createThread(deps, input);
  return mutateExisting(deps, input);
}

async function createThread(
  deps: MutateThreadDeps,
  input: MutateThreadInput,
): Promise<MutateThreadResult> {
  const projectId = input.projectId;
  if (projectId === null) throw new ThreadNotVisibleError();
  const title = normalizeTitle(input.title);

  // 观察者恒无写权。**接口拒绝**，不只是按钮不渲染（R7 / 服务端判权）——
  // 而且拒绝也留痕（V8），否则反复试探是零成本的。
  const membership = await deps.repo.findProjectMembership(input.userId, projectId, input.orgId);
  const role = membership?.projectRole ?? null;
  if (role === null || role === "observer") {
    await auditRefusal(deps, input, projectId, "NO_WRITE_ROLE");
    throw new NoWriteRoleError();
  }

  const threadId = deps.artifactIds.next("thr");
  await deps.chat.createThread({
    orgId: input.orgId,
    threadId,
    projectId,
    groupId: input.groupId,
    title,
    // 五值封闭由数据库 CHECK 兜（迁移 0021 的 `chat_threads_visibility_scope`）——
    // 这里不再抄一份枚举：抄一份就是第二处声明。
    visibilityScope: input.visibilityScope ?? "group-shared",
    createdBy: input.userId,
  });

  const auditEventId = await deps.provenance.append({
    orgId: input.orgId,
    type: CHAT_LIFECYCLE_AUDIT_TYPE,
    actorId: input.userId,
    target: { kind: "project", id: projectId },
    detail: { chatOp: "create", threadId, title },
  });
  return { threadId, version: 0, auditEventId, impactScope: null };
}

async function mutateExisting(
  deps: MutateThreadDeps,
  input: MutateThreadInput,
): Promise<MutateThreadResult> {
  const { threadId, projectId, expectedVersion } = input;
  if (threadId === null || projectId === null || expectedVersion === null) {
    throw new ThreadNotVisibleError();
  }

  // 写路径的前置也是**同一个**可见性判定。不可见与不存在同一个出口（I-3）：
  // 「改不了」与「没有这个东西」若给出不同回答，改名接口就成了存在性探测器。
  const outcome = await resolveVisibility(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId,
    threadId,
  });
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  // 归档线程只读：**全部写操作被拒**（I-15），改名/删除都在内。
  if (outcome.thread.archived) {
    await auditRefusal(deps, input, projectId, "THREAD_ARCHIVED_READONLY");
    throw new ThreadArchivedReadonlyError();
  }

  const role = outcome.actor.projectRole;
  if (role === null || role === "observer") {
    await auditRefusal(deps, input, projectId, "NO_WRITE_ROLE");
    throw new NoWriteRoleError();
  }

  if (input.op === "rename") {
    const title = normalizeTitle(input.title);
    const version = await deps.chat.renameThread(input.orgId, threadId, title, expectedVersion);
    if (version === null) throw new VersionChangedError();
    const auditEventId = await deps.provenance.append({
      orgId: input.orgId,
      type: CHAT_LIFECYCLE_AUDIT_TYPE,
      actorId: input.userId,
      target: { kind: "project", id: projectId },
      detail: { chatOp: "rename", threadId, title, version },
    });
    return { threadId, version, auditEventId, impactScope: null };
  }

  // 影响范围在删除**之前**读出来。见文件头。
  const messageCount = await deps.chat.countMessages(input.orgId, threadId);
  const deleted = await deps.chat.deleteThread(input.orgId, threadId, expectedVersion);
  if (deleted === null) throw new VersionChangedError();
  const auditEventId = await deps.provenance.append({
    orgId: input.orgId,
    type: CHAT_LIFECYCLE_AUDIT_TYPE,
    actorId: input.userId,
    target: { kind: "project", id: projectId },
    detail: {
      chatOp: "delete",
      threadId,
      reason: input.reason,
      messageCount,
      expectedVersion,
    },
  });
  return {
    threadId,
    version: expectedVersion,
    auditEventId,
    impactScope: `${messageCount} 条消息随线程删除`,
  };
}

/**
 * 被拒的写尝试也写审计（uc-8-1 R7 / uc-8-5 V8）。
 *
 * ⚠ 它**不吞异常**：审计写不下去时这次拒绝会以另一个错误冒出来，而不是「拒绝了但没留痕」。
 *   「可拒绝」与「必留痕」是同一个原子动作，与 I-8 同一条道理。
 */
async function auditRefusal(
  deps: MutateThreadDeps,
  input: MutateThreadInput,
  projectId: string,
  reason: string,
): Promise<void> {
  await deps.provenance.append({
    orgId: input.orgId,
    type: CHAT_REFUSAL_AUDIT_TYPE,
    actorId: input.userId,
    target: { kind: "project", id: projectId },
    detail: { chatOp: input.op, threadId: input.threadId, reason },
  });
}
