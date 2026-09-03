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
  /**
   * 2026-09-03（F109 续，ad-hoc，见 `packages/contracts/src/provenance.ts`
   * `thread-pinned`/`thread-unpinned` 头注）—— 与另外三个同一张映射表，
   * 不是「置顶比较轻量所以另开一条路径」。
   */
  pin: "thread-pinned",
  unpin: "thread-unpinned",
} as const satisfies Record<"create" | "rename" | "delete" | "pin" | "unpin", ProvenanceEventKind>;

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
  readonly op: "create" | "rename" | "delete" | "pin" | "unpin";
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

/** 个人线程 create 的自动默认名（留空即起名，不是拒绝）。内容自动命名（取首条消息）是后续。 */
export const DEFAULT_PERSONAL_THREAD_TITLE = "新对话";

/**
 * 个人线程 **create** 的标题规则——与 rename 路径**故意不同**：
 * 留空/纯空格 = 起默认名（一键即建：用户不必先想标题），非空仍按 `normalizeTitle` 校验长度。
 *
 * ⚠ 为什么单独一个函数而不复用 `normalizeTitle`：`normalizeTitle` 空标题抛 `TITLE_INVALID`，
 *   那是 rename 的正确语义（把标题清空不是合法编辑）。但 create 空标题曾经也抛——而个人
 *   对话新建表单的占位符逐字写着「留空则自动命名」，两者矛盾：留空实际会 422。这里让
 *   create 的空标题**如占位符承诺**地起默认名，把那句假承诺变成真的。rename 仍走 `normalizeTitle`。
 */
function titleForPersonalCreate(raw: string | null): string {
  const t = (raw ?? "").trim();
  if (t.length === 0) return DEFAULT_PERSONAL_THREAD_TITLE;
  if (t.length > 200) throw new TitleInvalidError();
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
  // 🔴 #594：`projectId === null` 不再一律拒绝——那一条改成了独立分支。
  // 项目分支（下面 `if (projectId !== null)` 之后）**一个字没动**。
  if (projectId === null) return createPersonalThread(deps, input);

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

/**
 * 🔴 #594 —— 个人线程的创建。**没有成员资格判定**：个人线程不属于任何项目，
 * 「谁能建」这个问题的答案是「任何登录到这个组织的人」，与项目分支「必须持有
 * 非观察者的项目角色」是两条不同的门（项目分支管的是「你在这场里是什么人」，
 * 这里管的是「你有没有登录」，本来就该是不同的判据，不是漏判）。
 *
 * `groupId` 强制为 `null`：个人线程没有组的概念，即便调用方在请求体里塞了一个
 * `groupId`（契约允许，因为它是给项目分支用的同一个字段），这里也不采信——
 * 采信了会让一条不挂靠项目的线程带着一个指向某个项目分组的外键，
 * `chat_threads.group_id` 的外键目标是 `groups(id)`，写一个不相关的组号
 * 大概率直接撞 23503，但「大概率撞外键」不是「不可能悄悄写对」的证明，
 * 这里在应用层就把这条路堵死。
 *
 * 默认可见范围复用 `private`（原语义「研究阶段：仅创建者」延伸覆盖「无项目：
 * 仅创建者」——两者本来就是同一句话「仅创建者可读」，不新增第六个枚举值；
 * 见 `packages/contracts/src/chat.ts` 的 `ChatVisibility` 头注与本束
 * `MIGRATION-IMPACT.md`）。
 */
async function createPersonalThread(
  deps: MutateThreadDeps,
  input: MutateThreadInput,
): Promise<MutateThreadResult> {
  // 个人对话新建：留空即起默认名（占位符「留空则自动命名」的兑现），不再 422。
  const title = titleForPersonalCreate(input.title);
  const threadId = deps.artifactIds.next("thr");
  await deps.chat.createThread({
    orgId: input.orgId,
    threadId,
    projectId: null,
    groupId: null,
    title,
    visibilityScope: input.visibilityScope ?? "private",
    createdBy: input.userId,
  });

  const auditEventId = await deps.provenance.append({
    orgId: input.orgId,
    type: CHAT_LIFECYCLE_AUDIT_TYPE.create,
    actorId: input.userId,
    target: { kind: "thread", id: threadId },
    detail: { projectId: null, title },
  });
  return { threadId, version: 0, auditEventId, impactScope: null };
}

async function mutateExisting(
  deps: MutateThreadDeps,
  input: MutateThreadInput,
): Promise<MutateThreadResult> {
  const { threadId, expectedVersion } = input;
  // 🔴 #594：`projectId` 从这条恒拒的名单里移出——个人线程的改名/删除请求
  // 里 `projectId` 本来就是 `null`（客户端没有项目可填，也不该被逼着编一个）。
  // `resolveVisibility` 自己知道 `null` 意味着走哪条分支。
  if (threadId === null || expectedVersion === null) {
    throw new ThreadNotVisibleError();
  }

  // 写路径的前置也是**同一个**可见性判定。不可见与不存在同一个出口（I-3）：
  // 「改不了」与「没有这个东西」若给出不同回答，改名接口就成了存在性探测器。
  //
  // ⚠ 传的是 `input.projectId`（调用方声称的），**不是** `resolveVisibility` 事后
  // 查到的真实 `thread.projectId`——这正是 mismatch 门要检查的东西：调用方声称
  // 「这是个人线程」（传 null）但线程其实挂着项目，`resolveVisibility` 的门①
  // 会把它当不存在拒掉，而不是这里先"聪明地"补上真实 projectId 替调用方纠错。
  const outcome = await resolveVisibility(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.projectId,
    threadId,
  });
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  // `outcome.thread.projectId` 才是这条线程**真实**挂靠的项目（或 null）——
  // 从这里开始的审计 `detail.projectId` 都用它，不用 `input.projectId`。
  const realProjectId = outcome.thread.projectId;

  // 归档线程只读：**全部写操作被拒**（I-15），改名/删除都在内。项目线程与个人线程
  // 共用这一条——个人线程今天没有归档入口能把 `archived` 置真，但判定本身不该
  // 假设「个人线程永远不归档」，那是产品以后可能补的入口，不是这里的前提。
  if (outcome.thread.archived) {
    await auditRefusal(deps, input, realProjectId, "THREAD_ARCHIVED_READONLY");
    throw new ThreadArchivedReadonlyError();
  }

  // 🔴 #594：项目线程走角色门（观察者/无角色恒拒）；个人线程**不查角色**——
  // `resolveVisibility` 的个人分支已经把「非创建者」挡在 `outcome.kind !== "allow"`
  // 那一步了，能走到这里的个人线程请求，调用者就是创建者，创建者对自己的线程
  // 恒有写权。这不是漏了角色判定，是这条线程根本没有"角色"这个概念——
  // 硬套项目分支的角色检查（`actor.projectRole === null ⇒ 拒`）会把创建者自己拒掉，
  // 因为个人线程的 `actor.projectRole` 恒为 `null`（`resolvePersonalVisibility`
  // 明确写死），那不是「无角色」，是「这个维度不适用」。
  if (realProjectId !== null) {
    const role = outcome.actor.projectRole;
    if (role === null || role === "observer") {
      await auditRefusal(deps, input, realProjectId, "NO_WRITE_ROLE");
      throw new NoWriteRoleError();
    }
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
      detail: { projectId: realProjectId, title, version },
    });
    return { threadId, version, auditEventId, impactScope: null };
  }

  if (input.op === "pin" || input.op === "unpin") {
    const pinned = input.op === "pin";
    const version = await deps.chat.setThreadPinned(input.orgId, threadId, pinned, expectedVersion);
    if (version === null) throw new VersionChangedError();
    const auditEventId = await deps.provenance.append({
      orgId: input.orgId,
      type: CHAT_LIFECYCLE_AUDIT_TYPE[input.op],
      actorId: input.userId,
      target: { kind: "thread", id: threadId },
      detail: { projectId: realProjectId, pinned, version },
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
    detail: { projectId: realProjectId, reason: input.reason, messageCount, expectedVersion },
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
  /**
   * 🔴 #594：`string | null`。个人线程的拒绝事件（今天只有「已归档」这一档能到达
   * 这里——个人线程没有角色门，见 `mutateExisting`）里 `projectId` 就是 `null`。
   * ⚠ `input.threadId === null` 分支的 `target: {kind:"project", id: projectId}`
   * 只在**被拒的 create** 上可达，而个人线程的 create 从不调用本函数（没有拒绝路径，
   * 见 `createPersonalThread` 头注），所以那一支的 `projectId` 在实践中恒非空——
   * 但类型层面仍是 `string | null`，`String(projectId)` 兜底而不是断言非空，
   * 免得下一个新增的个人线程拒绝路径在这里悄悄崩溃。
   */
  projectId: string | null,
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
        ? ({ kind: "project", id: projectId ?? `personal:${input.userId}` } as const)
        : ({ kind: "thread", id: input.threadId } as const),
    detail: { chatOp: input.op, projectId, reason },
  });
}
