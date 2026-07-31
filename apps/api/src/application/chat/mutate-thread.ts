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
 * ## 对话侧审计事件的类型码 —— **ADR-101（Proposed，需人类追认）**
 *
 * ### 这里曾经是什么样
 *
 * 本文件第一版把三种线程动作**全写成 `human-edited`**（常量 `CHAT_LIFECYCLE_AUDIT_TYPE`，
 * 文件头标红「已知的语义错配，不是笔误」），因为 `provenance.ProvenanceEventType` 是
 * 封闭枚举、里面没有任何一档对应「线程被建/被改名/被删」，`target.kind` 也没有 `thread`。
 * 那正是 `chat` 契约 `KNOWN_CONTRACT_GAPS.C_CHAT_5` 登记的缺口。
 *
 * **这段历史刻意保留**：ADR-101 的状态是 **Proposed**，人类可能**否决**。
 * 否决时的回退动作写在 ADR 的「如果人类否决」一节——第 1、2 条会把这两个枚举退回去，
 * 届时本文件必须退回顶包写法。把历史抹掉，回退的人就得重新推导一遍当初为什么这么写。
 *
 * ### 现在
 *
 * ADR-101 一次补齐了两个封闭枚举（`ProvenanceEventType` + 新提取的 `ProvenanceTargetKind`），
 * 其中代 F109 补的正是本文件报上去的那三个成员与那一个 target kind。**名字是照抄的**，
 * 所以这里应当直接用得上——用不上说明抄错了，那是个可发现的错误。
 *
 * ### 🔴 仍然未裁：target 维度（ADR-101 决策 B）
 *
 * `target` 现在是 `{kind:"thread", id: threadId}`，规矩来自 `record-audit.ts` 头部
 * 「**target 是验收标准说你按什么去搜的那个东西**」——uc-8-1 R7 的检索面是
 * 「操作者 / 时间 / **对象** / 结果」，对象是线程。
 *
 * 于是 `projectId` 只能放进 `detail`。⚠ **这是临时的，不是结论**：ADR-101 决策 B
 * 逐字写着「悬而未决期间，F109 / F117 / F80 落地时仍需在 `detail` 里放 id；
 * 那是临时的……落地时请引用本 ADR，不要各自解释一遍」。⇒ 这里就是那一次引用，
 * 不重复三条出路的论证。
 *
 * 它现在的**具体代价**：`chat.queryChatAuditEvents` 的 path 是
 * `/chat/projects/:projectId/audit-events`（按项目列），而 `queryProvenance` 只按
 * `(targetKind, targetId)` 筛 ⇒ 「列出本项目下的全部对话审计」**没有可筛的列**。
 * F109 不实现那个端口，所以它没挡住本 feature；实现它的人会第一个撞上。
 */
import type { OrgId } from "../../domain/org-id";
import type { ProvenanceWriter } from "../provenance/ports";
import type { ProvenanceEventKind } from "../provenance/ports";
import type { IdFactory } from "../artifact/ports";
import type { ChatRepository } from "./ports";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";
import { ThreadNotVisibleError } from "./get-thread";

/**
 * 三个动作 → 三个事件类型。**全仓唯一的一处映射**，别在调用点各自写一个。
 *
 * ⚠ **三个分开，不合并成一个 `thread-changed` + `detail.op`**（ADR-101 决策 A 逐字）：
 *   合并意味着「查所有删除」得先解析 jsonb，而 `queryProvenance` 的筛选面上没有那个能力——
 *   那条查询在契约层根本不存在。而 uc-8-1 R7 要求的恰恰是删除可追溯。
 *
 * `satisfies` 而不是类型标注：标注会把值放宽成整个枚举，而这里要的正是
 * 「少写一个 op 就编译不过」——`Record<Op, …>` 的穷尽性是这个映射存在的一半理由。
 */
const CHAT_LIFECYCLE_AUDIT_TYPE = {
  create: "thread-created",
  rename: "thread-renamed",
  delete: "thread-deleted",
} as const satisfies Record<"create" | "rename" | "delete", ProvenanceEventKind>;

/**
 * 越权尝试也必须留痕（V8）。
 * ⚠ 这一档**从来没有**属于上面那个缺口：`unauthorized-attempt` 语义本来就对，
 *   ADR-101 也逐字写了「F80 / F109 的『被拒尝试』用它语义本来就对」，不动。
 */
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
    type: CHAT_LIFECYCLE_AUDIT_TYPE.create,
    actorId: input.userId,
    // target = 线程，projectId 进 detail。⚠ 后者是**临时**的，见文件头（ADR-101 决策 B 未裁）。
    target: { kind: "thread", id: threadId },
    detail: { projectId, title },
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
      type: CHAT_LIFECYCLE_AUDIT_TYPE.rename,
      actorId: input.userId,
      target: { kind: "thread", id: threadId },
      detail: { projectId, title, version },
    });
    return { threadId, version, auditEventId, impactScope: null };
  }

  // 影响范围在删除**之前**读出来。见文件头。
  const messageCount = await deps.chat.countMessages(input.orgId, threadId);
  const deleted = await deps.chat.deleteThread(input.orgId, threadId, expectedVersion);
  if (deleted === null) throw new VersionChangedError();
  const auditEventId = await deps.provenance.append({
    orgId: input.orgId,
    type: CHAT_LIFECYCLE_AUDIT_TYPE.delete,
    actorId: input.userId,
    // ⚠ 线程行马上就没了，而事件仍指向它——这正是删除追溯要的：
    //   `provenance_events` 与 `chat_threads` 之间没有外键，事件不随对象消失。
    target: { kind: "thread", id: threadId },
    detail: { projectId, reason: input.reason, messageCount, expectedVersion },
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
    // 被拒的 create 还没有线程可指，退回项目；rename / delete 指线程。
    // ⚠ 不是「统一指项目省事」：一次被拒的删除尝试与那条线程的其余事件必须查得到一起，
    //   否则「谁试过删它」和「谁删掉了它」在审计里落在两个不同的对象上。
    target:
      input.threadId === null
        ? ({ kind: "project", id: projectId } as const)
        : ({ kind: "thread", id: input.threadId } as const),
    detail: { chatOp: input.op, projectId, reason },
  });
}
