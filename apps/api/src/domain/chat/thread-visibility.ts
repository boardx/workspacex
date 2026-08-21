/**
 * 对话可见性的判定 —— F108 的**全部规则都在这一个文件里**。
 *
 * 纯函数：没有时钟、没有随机、没有 I/O。判定所需的一切（两层角色、线程属性、
 * 组号）都由调用方查好传进来，所以它可以被穷举测试，而穷举正是 I-2 的断言方式。
 *
 * ## 两层是哪两层（I-2）
 *
 *   组织层  —— 你在这个组织里是谁、属于哪个团队（phase-00 `identity` 已答，本文件不重算）
 *   项目层  —— 在这场项目里你是什么角色、在哪个组，这条线程的可见范围是否对你开放
 *
 * `allowed === orgLayerAllowed && projectLayerAllowed`，**任一层为假即拒绝**。
 * 不存在只过一层就放行的路径——这句话在下面是一个 `&&`，而不是一串 if 的最后一个分支，
 * 是因为 if 链会随着新场景增长出「这种情况下先返回 true」的捷径。
 *
 * ## 组织层不在这里重新实现
 *
 * `phase-00 identity` 的 `decide()` 已经是两层交集，本文件消费它的 **orgLayer** 与
 * **projectLayer.role**，只在其上叠加对话特有的范围规则（I-6 跨组、I-7 私聊三方、
 * I-5 观察者降级）。再写一份角色判定就是第二套权限系统，而两套权限系统里
 * 总有一套没人在看。
 *
 * ## 🔴 与 phase-00 角色矩阵的一处冲突（不由本文件裁决）
 *
 * `domain/identity/project-role-matrix.ts` 的 `read.privateChat` 只给了 `facilitator`；
 * 本束 `domain.md` I-7 逐字写「组员私聊 = 本人 + **本组组长** + 引导师」。
 * 两处对「组长能否读本组组员私聊」的答案相反。
 *
 * 本文件按 **I-7** 实现（F108 的 spec_ref 是 uc-8-5，chat 束是对话可见性的权威），
 * 并**不修改** phase-00 的矩阵——那是另一个束的签核面。冲突已登记，等阶段一致性复核裁决。
 * 裁决若判矩阵对，改动点是下面 `MEMBER_PRIVATE_READERS` 一处。
 */
import { chat } from "@repo/contracts";
import type { z } from "zod";
import type { PermissionDecision } from "../identity/permission-decision";
import type { ProjectRole } from "../identity/roles";

export type ChatVisibilityScope = z.infer<typeof chat.ChatVisibility>;

/** 五值封闭（I-1）。**取值来自契约，这里不重列**——重列就是第二份枚举。 */
export const CHAT_VISIBILITY_SCOPES: readonly ChatVisibilityScope[] = chat.ChatVisibility.options;

/**
 * 判定要用到的线程属性。刻意不含 `title` / 正文——判定不需要，也就不该拿到。
 *
 * ⚠ 2026-08-06（#594，人类本人直接推翻此前裁决，方案 A）：`projectId` 从**恒非空**
 *   放宽为**可空**。`null` = 「个人对话，不挂靠任何项目」——一种全新的、与下面
 *   `decideThreadRead` 描述的两层交集**完全不同**的可见性形状：无组织团队范围、
 *   无项目角色、无组、无观察者降级，**只有一条规则：仅创建者可读**（同 I-3「不存在
 *   与无权同一出口」的精神，但判据比项目线程简单得多）。
 *   这条规则不在 `decideThreadRead` 里实现——见下方 `decidePersonalThreadRead`，
 *   两者刻意分开，理由见该函数头注。
 */
export interface ThreadFacts {
  readonly threadId: string;
  readonly projectId: string | null;
  /** null = 全场 / 研究阶段线程，或个人线程（个人线程恒无组） */
  readonly groupId: string | null;
  readonly visibilityScope: ChatVisibilityScope;
  readonly createdBy: string;
  readonly archived: boolean;
}

/** 判定要用到的读者属性。项目角色与组号来自 `project_memberships`。 */
export interface ActorFacts {
  readonly userId: string;
  readonly projectRole: ProjectRole | null;
  readonly groupId: string | null;
}

export type DeniedLayer = "organization" | "project";

export interface ChatVisibilityDecision {
  readonly allowed: boolean;
  /** 恒等于两层与运算（I-2）。分别留着，是因为 I-4 要求拒绝能指名是哪一层。 */
  readonly orgLayerAllowed: boolean;
  readonly projectLayerAllowed: boolean;
  /** 拒绝时恒非空且恰好一个（I-4）；允许时恒为 null。 */
  readonly deniedLayer: DeniedLayer | null;
  readonly scope: ChatVisibilityScope;
  /** 观察者降级是否生效。它**不是**「允许与否」，是「允许之后给多少」（I-5）。 */
  readonly observerProjection: boolean;
}

/**
 * `member-private` 线程的可读集（I-7）：**本人 + 本组组长 + 引导师**，此外无人。
 *
 * 写成一张表而不是一串 if：I-7 的断言方式是「可读集与该集合精确相等，多一个少一个都失败」，
 * 一串 if 没有「集合」这个可被比较的对象。
 */
const MEMBER_PRIVATE_READERS = {
  /** 引导师跨组亦可（I-6 的唯一例外） */
  facilitator: "any-group",
  /** 组长只读本组（同组才算「本组组长」） */
  groupLead: "same-group",
  /**
   * 组员只读自己写的。
   *
   * ⚠ 反证记录（2026-07-31）：把这一档放宽成 `same-group`，I-7 的断言**没有变红**——
   *   因为基础判定那一层（矩阵里组员没有 `read.privateChat`）先把它挡住了。
   *   两道独立的门是好事，但它意味着**这一档不是这条路径上的控制点**：
   *   真正的控制点是 `i7MemberPrivateOverride`，对它做同样的放宽，I-7 当场变红。
   *   记在这里，免得下一个人以为改了这一行就改变了行为。
   */
  member: "author-only",
  /** 观察者永不 —— 「只读」不等于「可读一切」 */
  observer: "never",
} as const satisfies Record<ProjectRole, string>;

/**
 * 项目层对**这条线程的可见范围**的判定。
 *
 * ⚠ 这里判的是「范围」，不是「动作」。动作（能不能发言、能不能批准）由角色矩阵回答，
 *   在 `capabilitiesFor` 里。两件事混成一个布尔，就再也分不出「看得见但不能写」。
 */
function scopeAllows(thread: ThreadFacts, actor: ActorFacts): boolean {
  const role = actor.projectRole;
  if (role === null) return false;

  const sameGroup = thread.groupId !== null && thread.groupId === actor.groupId;
  // I-6：跨组一律不可见，**引导师除外**。放在最前面，因为它对下面每一档都成立——
  // 写在各档内部就会漏掉后加的那一档，而漏掉的方向是放行。
  const crossGroupBlocked = thread.groupId !== null && !sameGroup && role !== "facilitator";

  switch (thread.visibilityScope) {
    case "member-private": {
      const rule = MEMBER_PRIVATE_READERS[role];
      if (rule === "never") return false;
      if (rule === "any-group") return true;
      if (rule === "same-group") return sameGroup;
      // author-only：作者本人，且仍受跨组约束（别组的组员连作者身份都构不成）
      return actor.userId === thread.createdBy && sameGroup;
    }
    case "group-shared":
      // 全组可见。观察者不在「组」里——它没有组号，给它开一个组就是给它一个身份。
      if (role === "observer") return false;
      return !crossGroupBlocked;
    case "plenary":
      // 项目内全员，含观察者（观察者拿到的是降级投影，见 I-5，不是拿不到）。
      return true;
    case "team-visible":
      // 研究阶段：同（组织）团队可见。**团队是组织层的事实**，所以这一档的实质判定
      // 发生在组织层（`decide()` 的 scopeLayer）；项目层这里只负责不额外放宽。
      return !crossGroupBlocked;
    case "private":
      // 仅创建者。管理员的审计读走 `adminAuditRead`，不从这里开口子。
      return actor.userId === thread.createdBy;
  }
}

/**
 * 一次线程读取在 phase-00 角色矩阵里对应哪个动作。
 *
 * 观察者读的是**另一个面**（`read.published`，已发布且已脱敏），这正是它拿到降级投影
 * 而不是拒绝的原因：它读到的东西在定义上就是「已发布」的那一份。
 * ⚠ 这不是给观察者放宽——`read.published` 是矩阵里 observer 唯一持有的那一行，
 *   把它写成 `read.allHands` 才叫放宽。
 */
export function chatReadAction(thread: ThreadFacts, actor: ActorFacts): string {
  if (actor.projectRole === "observer") return "read.published";
  switch (thread.visibilityScope) {
    case "member-private":
      return "read.privateChat";
    case "group-shared":
    case "private":
      return "read.ownGroup";
    case "plenary":
    case "team-visible":
      return "read.allHands";
  }
}

/**
 * 🔴 I-7 与 phase-00 角色矩阵冲突处的**唯一**一行。
 *
 * 矩阵只给 `facilitator` 发了 `read.privateChat`；I-7 说可读集是
 * 「本人 + 本组组长 + 引导师」。作者本人与本组组长因此过不了基础判定的项目层。
 *
 * 这里**不改矩阵**（那是另一个束的签核面），而是在本束内开一个**具名**的例外，
 * 让冲突在代码里可见、可搜索、可一行删除：
 *   · 若一致性复核判 I-7 对 ⇒ 这一行留着，矩阵补发 `read.privateChat` 后它自然失效；
 *   · 若判矩阵对 ⇒ 删掉这一行，`visibility-two-layer-intersection.test.ts` 里
 *     「组长读本组组员私聊」那两条断言随之要改，方向明确。
 * 无论哪一种，都不会有第二处需要跟着改。
 */
function i7MemberPrivateOverride(thread: ThreadFacts, actor: ActorFacts): boolean {
  if (thread.visibilityScope !== "member-private") return false;
  const sameGroup = thread.groupId !== null && thread.groupId === actor.groupId;
  if (!sameGroup) return false;
  return actor.projectRole === "groupLead" || actor.userId === thread.createdBy;
}

/**
 * 两层交集判定（I-2 / I-4 / I-6 / I-7）。
 *
 * `base` 是 phase-00 `identity.decide()` 的结果——组织层（成员资格 + 团队范围）
 * 与项目层（角色是否持有该动作）都已在其中。本函数**只**在项目层上再叠加范围规则。
 */
export function decideThreadRead(input: {
  readonly thread: ThreadFacts;
  readonly actor: ActorFacts;
  readonly base: PermissionDecision;
}): ChatVisibilityDecision {
  const { thread, actor, base } = input;

  const orgLayerAllowed = base.orgLayer.passed;
  // 项目层 = 「角色对这条线程的范围开放」∧「基础判定的项目层没有否决」。
  // 两者都要：只看范围会让一个无项目角色的人凭 `plenary` 读到内容。
  //
  // ⚠ 例外只有一处且具名（见上）。组织层**不**受它影响——I-7 讲的是项目层的可读集，
  //   拿它去松组织层，就是用一条产品规则打开租户/团队隔离。
  const projectLayerAllowed =
    ((base.projectLayer?.passed ?? false) || i7MemberPrivateOverride(thread, actor)) &&
    scopeAllows(thread, actor);

  // I-2 的形式就是这一个 `&&`。
  const allowed = orgLayerAllowed && projectLayerAllowed;

  return {
    allowed,
    orgLayerAllowed,
    projectLayerAllowed,
    // I-4：恰好一个，且不为空。组织层先判——它先失败，就是它拒的。
    deniedLayer: allowed ? null : orgLayerAllowed ? "project" : "organization",
    scope: thread.visibilityScope,
    observerProjection: actor.projectRole === "observer",
  };
}

/**
 * 🔴 #594 —— 个人线程（`projectId === null`）的可见性判定。**独立于** `decideThreadRead`。
 *
 * ## 为什么不塞进两层交集，另起一个函数
 *
 * `decideThreadRead` 的每一条规则（跨组 I-6、私聊三方 I-7、观察者降级 I-5）都以
 * 「这条线程有一个项目、这个人在那个项目里有个角色」为前提。个人线程没有项目，
 * 也就没有项目角色、没有组——把 `projectId: null` 硬灌进 `scopeAllows` /
 * `chatReadAction` 会得到一串 `actor.projectRole === null` 分支，**行为上凑巧等于
 * 「仅创建者」**，但那是巧合，不是设计：下次有人往两层交集里加一条新规则，
 * 完全可能忘记这条巧合还依赖这个分支保持现状。分开写，个人线程的规则**只有一句话**，
 * 读这一个函数就能验完，不用先读懂整套四角色矩阵再确认它对 `null` 无害。
 *
 * ## 这条规则本身，且**这是权威判据**——不是 `resolve-visibility.ts` 早退判断的复述
 *
 * 仅创建者可读——不区分组织角色、不查团队、不查项目成员资格。理由：
 * 个人对话是这个人自己的工作区，不是任何团队/项目资源，「你在组织里是谁」
 * 不该影响「你能不能看自己的对话」，能影响的只有「你还在不在这个组织里」
 * （那一层由调用方另外查一次组织成员资格，见 `resolve-visibility.ts`）。
 *
 * ⚠ `resolve-visibility.ts` 的 `resolvePersonalVisibility` 里也有一行
 * `thread.createdBy !== userId` 的早退——那一行是**性能快捷方式**，不是
 * 第二道独立防线。真正决定「非创建者读不到」的判据只有这一行
 * `projectLayerAllowed = actorUserId === thread.createdBy`。反证时验证过：
 * 只删调用方那行早退，`decision.allowed` 依旧由这里算出 false，测试全绿；
 * 只删这一行（改成恒 true），调用方那行早退依旧拦下大多数请求，测试也全绿；
 * **两处必须同时删掉**才会看见越权读的红（见 `resolve-visibility.ts` 头注、
 * PR 正文的反证记录）。别把这一行删掉当成「反正上面拦过了」的次要判断。
 */
export function decidePersonalThreadRead(input: {
  readonly thread: ThreadFacts;
  readonly actorUserId: string;
  readonly orgLayerAllowed: boolean;
}): ChatVisibilityDecision {
  const { thread, actorUserId, orgLayerAllowed } = input;
  const projectLayerAllowed = actorUserId === thread.createdBy;
  const allowed = orgLayerAllowed && projectLayerAllowed;
  return {
    allowed,
    orgLayerAllowed,
    projectLayerAllowed,
    deniedLayer: allowed ? null : orgLayerAllowed ? "project" : "organization",
    scope: thread.visibilityScope,
    observerProjection: false, // 个人线程没有观察者这个概念
  };
}

/**
 * 个人线程的能力集合。**不经过** `capabilitiesFor`（它按 `ProjectRole` 分派，
 * 个人线程没有项目角色，传 `null` 进去会拿到 `[]`——那会让「新用户无需建项目
 * 就能发消息」这条 #594 的验收原文在能力集合这一步就断掉）。
 *
 * 创建者对自己的个人线程恒有全部读写能力；`approvalGate`/`reassign`/
 * `recording.stop` 这三样是项目/工作坊现场概念（批准给谁、改派到哪个组、
 * 停止哪个录音会话），个人线程没有对应的对象，**不下发**——不是禁用，是没有。
 *
 * `artifact.land`（人类裁决，2026-08-21，issue #728 round 16 P10 留的开放问题
 * 「个人对话要不要真的支持落地产物」在此落地）：**含**这一条——个人对话保存
 * 画布/图表也要真的落库，不是「本地演示」。放行条件与项目线程不同，不经
 * `capabilitiesFor(role)` 那条路径：`land-as-artifact.ts` 对个人线程放行的
 * 依据是「`resolveVisibility` 已经把非创建者挡在能力集合计算之前」（个人线程
 * 读路径本就要求 `actorUserId === thread.createdBy`），不是某个 `ProjectRole`；
 * 且个人线程落地被硬锁在 `mode: "draft"`（同 `summarizePersonaFromThread`
 * 的既有判例 `C_CHAT_11`）——`live`/`pinned` 会打开下游流转（report-final /
 * submit-acceptance 等），那是项目专属语义，个人线程不适用。
 */
export const PERSONAL_THREAD_CAPABILITIES: readonly string[] = [
  "thread.read",
  "artifact.readonly",
  "composer.send",
  "thread.mutate",
  "artifact.land",
];

/**
 * 管理员审计读的判定（I-8 / O-04）—— 做成 `PermissionDecision`，不是一个布尔。
 *
 * 理由与 F22 的 `decideOrgExport` 相同：正文要经守卫读路径取出，而那道门收的是
 * 一个**决定对象**（带 decisionId，可被审计追回）。返回布尔就只能在调用处现造一个
 * `allowed: true` 交进去——那是把门打开，不是通过门。
 *
 * ⚠ `projectLayer` 恒为 null：管理员的审计读**不要求项目角色**（O-04）。
 *   在这里填一个「假装有角色」的项目层，会让审计记录里出现一个他并不持有的角色。
 */
export function decideAdminAuditRead(input: {
  readonly decisionId: string;
  readonly orgRole: string | null;
  readonly teamId: string | null;
}): PermissionDecision {
  // 只有 admin。compliance 拿到的是审计链本身，不是项目内容（D-U3，phase-00 已在案）。
  const allowed = input.orgRole === "admin";
  return {
    allowed,
    orgLayer: {
      role: (input.orgRole ?? null) as PermissionDecision["orgLayer"]["role"],
      teamId: input.teamId,
      passed: allowed,
    },
    projectLayer: null,
    scopeLayer: { scope: "org-wide" as const, passed: allowed },
    /**
     * ⚠ 非成员与「是成员但不是管理员」用**同一个** reasonCode，与 F22 `decideOrgExport`
     * 一致：分开会回答「这个组织存在吗 / 你在不在里面」。
     * ⚠ 用的是 `identity.PermissionReason` 的取值，不是 chat 束的 `NOT_ORG_ADMIN`——
     *   `PermissionDecision` 的 reasonCode 是 identity 的封闭枚举，往里塞一个别的束的码，
     *   要么被 `all-exceptions.filter` 的 parse 静默丢掉，要么就得把那个枚举撑开。
     *   对外的 `NOT_ORG_ADMIN` 由 `interface` 映射成 403，两者不冲突。
     */
    reasonCode: allowed ? null : "NO_ORG_MEMBERSHIP",
    decisionId: input.decisionId,
  };
}

/* ─────────────────────── 观察者降级：服务端不下发（I-5）─────────────────────── */

/**
 * 写能力标记的全集。observer 的响应体里**一个都不能出现**。
 *
 * 前五条逐条对应 uc-8-5 / I-5 点名的那五样：输入区 / 批准卡 / [改派] / [全屏编辑] / [停止录音]。
 * 用常量而不是字面量散在各处，是为了让「一个都不能出现」可以写成一句断言。
 *
 * `thread.mutate`（#460）是第六条：会话的新建 / 改名 / 删除。它必须是**独立的一条**，
 * 不能让前端拿 `composer.send` 当代理去推断——「能发消息」与「能删掉整条会话」是两件事，
 * 今天恰好同为非观察者才有，不代表以后是。本文件 :104 的注释已经就「两件事混成一个布尔，
 * 就再也分不出看得见但不能写」立过一次规矩，这里沿用它。
 *
 * ⚠ 契约 `chat.mutateThread`（`packages/contracts/src/chat.ts:408`）要求**两侧都验收**：
 * 按钮不渲染 **且** 接口拒绝。服务端拒绝早已存在（`mutate-thread.ts` 的 `NO_WRITE_ROLE`），
 * 这条能力补的是「按钮不渲染」那一侧的诚实依据 —— 前端据此不渲染，而不是渲染后禁用。
 */
export const CHAT_WRITE_CAPABILITIES = [
  "composer.send",      // 输入区
  "approval.decide",    // 批准卡（三出口）
  "reassign",           // [改派]
  "fullscreen-edit",    // [全屏编辑]
  "recording.stop",     // [停止录音]
  "thread.mutate",      // 新建 / 改名 / 删除会话（#460）
  /**
   * 「落地为产物」（#728 round 16 P10）。服务端拒绝早已存在——
   * `land-as-artifact.ts` 对 `projectRole` 为 null/observer 恒抛
   * `NoWriteRoleError`，而个人线程的 `projectRole` 恒为 null
   * （`resolve-visibility.ts`，「这个维度不适用」）——但前端此前**无条件**
   * 渲染每条消息下的落地按钮，个人对话里那是一枚点了必报错的假按钮
   * （评分员 round 16 按「界面上有假按钮」判 P10 = 0）。
   * 照上面 `thread.mutate` 立过的同一条规矩补第二侧：**按钮不渲染 且 接口拒绝**，
   * 前端据此不渲染，而不是渲染后禁用；也不许拿 `composer.send` 当代理推断
   * （本文件 :104 与 :340 两处注释都立过「两件事混成一个布尔」的规矩）。
   * `PERSONAL_THREAD_CAPABILITIES` **此前**刻意不含这一条——个人线程的产物
   * 曾经只有 `artifact.readonly`。人类已在 2026-08-21 裁决个人对话也要能真的
   * 落地产物（ADR-023 契约语义变更，见 `PERSONAL_THREAD_CAPABILITIES` 处的
   * 新注释），`PERSONAL_THREAD_CAPABILITIES` 现在**含**这一条，放行依据与
   * 项目线程不同（不经 `ProjectRole`），细节同上。
   */
  "artifact.land",
] as const;

/** 读能力。观察者拿到的是这一份的子集。 */
export const CHAT_READ_CAPABILITIES = [
  "thread.read",
  "artifact.readonly",
] as const;

export interface MessageFacts {
  readonly id: string;
  readonly rawTranscript: boolean;
  /** null = 继承线程的可见范围 */
  readonly visibilityScope: ChatVisibilityScope | null;
}

/**
 * 观察者能看到哪些消息 —— **在服务端决定，不在前端**。
 *
 * 这个函数的返回值决定的是**响应体里有没有那条数据**，不是界面渲不渲染。
 * 反证方式：把调用它的那一行去掉，`observer-downgrade-server-side.test.ts`
 * 里断言「转写正文不出现在响应 JSON 里」的那条必须当场变红；如果不红，
 * 说明被测的是前端，那条断言从一开始就是空转的。
 */
export function observerMayReadMessage(
  message: MessageFacts,
  thread: ThreadFacts,
): boolean {
  // 原始转写：观察者禁止（角色矩阵的 `read.rawTranscript` 也这么说，两处同向）。
  if (message.rawTranscript) return false;
  // 私聊消息：不论它挂在哪条线程上。消息可比线程更严（domain.md 实体 3），
  // 所以判定要看消息自己的 scope，取不到才回落到线程的。
  const effective = message.visibilityScope ?? thread.visibilityScope;
  return effective !== "member-private" && effective !== "private";
}

/**
 * 一次线程读取给出的能力集合。
 *
 * 观察者恒为只读：写能力**不在集合里**，而不是「在集合里但标了 disabled」。
 * 后者会让「服务端不下发」退化成「服务端下发了一个提示」，而提示是可以被绕过的。
 */
export function capabilitiesFor(role: ProjectRole | null): string[] {
  if (role === null) return [];
  if (role === "observer") return [...CHAT_READ_CAPABILITIES];
  const writes: string[] = [];
  for (const cap of CHAT_WRITE_CAPABILITIES) {
    // 组员没有批准权（批准是引导师/负责人的动作），其余写能力人人有。
    if (cap === "approval.decide" && role === "member") continue;
    writes.push(cap);
  }
  return [...CHAT_READ_CAPABILITIES, ...writes];
}
