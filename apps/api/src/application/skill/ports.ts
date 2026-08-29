/**
 * `skill` 束的 application 层端口（F61）。
 *
 * 洋葱中层：**只依赖 domain**，不知道 HTTP、不知道 PostgreSQL。
 * `infrastructure` 实现这些端口（依赖倒置），`interface` 调用用例。
 *
 * ## ⚠ 这里刻意**没有**的端口（缺了是结论，不是遗漏）
 *
 * · **没有 `SkillRuntime` / `Sandbox` / `CodeLoader`** —— D-06 已裁 phase-1 无沙箱、
 *   不执行任意代码。留一个空接口等于给下一个人一个入口（同契约文件头的措辞）。
 * · **没有数据库端口以外的取数通路** —— I-25：skill 运行时读上下文**只能**向
 *   Context API 请求 Context Pack。所以本文件只有 `ContextApiPort` 一个取数端口，
 *   而 `lint-skill-context-api-only.mjs` 机械保证 skill 模块的 import 图里
 *   没有 pg / 向量库客户端。**契约上唯一 ＋ 结构上唯一**，两条都要：
 *   只有前者时，加一行 `import pg` 就能绕过。
 */
import type { Guarded } from "../security/permission-filter";
import type { DataScopeKey } from "../../domain/skill/data-scope";
import type { SecurityScanResult } from "../../domain/skill/security-gate";
import type { DeclarativeContract } from "../../domain/skill/declarative-contract";
import type { SkillLifecycleStatus } from "../../domain/skill/skill-status";
import type { ReferenceSnapshot } from "../../domain/skill/reference-enumeration";
import type { SkillVersionSnapshot } from "../../domain/skill/version-chain";
import type { SkillOriginTag } from "../../domain/skill/source-tag";
import type {
  ProjectOrchestration,
  WorkflowTemplateBody,
} from "../../domain/skill/orchestration";
import type { ThreadSkillMount } from "../../domain/skill/thread-mount";
import type { ReviewerFunctionValue } from "../../domain/skill/review-authorization";
import type { PromotionLink } from "../../domain/skill/promotion-link";
import type {
  DataQualityEntry, RatingAttribution, RatingRecord,
} from "../../domain/skill/rating-attribution";
import type { SuggestionCategory } from "../../domain/skill/suggestion-aggregation";

/**
 * 提交人**当时**持有的数据范围（I-12 的上界）。
 *
 * 是端口而不是入参，因为「当时」这个词有内容：E6 要求操作过程中权限被撤回时
 * 立即终止后续写操作，那需要一次真实的、可在中途重问的解析。
 */
export interface SubmitterGrantsPort {
  grantsOf(principalId: string): Promise<readonly DataScopeKey[]>;
}

/**
 * 安全扫描器（门禁第一道，自动）。
 *
 * 扫的是**声明式内容本身**，所以入参是契约文本而不是一个版本 id 加一次装载。
 */
export interface SecurityScannerPort {
  scan(contract: DeclarativeContract): Promise<SecurityScanResult>;
}

/**
 * **Context API —— skill 运行时唯一的取数通路**（I-25 / I-24）。
 *
 * ⚠ 返回值里 `packId` 不是装饰：I-24 要求每一次 skill 运行**留下一条
 *   `context_packs` 记录**且可重放。一个不返回 pack 标识的取数端口，
 *   事后无法回答「这条结论当时看了什么」。
 */
export interface ContextApiPort {
  requestContextPack(input: {
    readonly runId: string;
    readonly orgId: string;
    readonly principalId: string;
    readonly query: string;
  }): Promise<{
    readonly packId: string;
    /** Context Pack **实际返回**的数据范围项。有效范围 ＝ 声明范围 ∩ 本项（I-24） */
    readonly returnedScopes: readonly DataScopeKey[];
  }>;
}

/** 草稿落库。⚠ 静态校验/越权检查**失败即不入库**，所以它只在成功路径上被调用。 */
export interface SkillDraftStorePort {
  saveDraft(input: {
    readonly orgId: string;
    readonly name: string;
    readonly duty: string;
    readonly contract: DeclarativeContract;
    readonly source: string;
    readonly submitterId: string;
    /** 契约 `createSkillDraft.in.visibility`。⚠ 与「审核状态」是两个独立字段，不互相推导 */
    readonly visibility: "org-wide" | "team-only";
    /** `visibility = team-only` 时必须非空——DB 侧 `skill_contracts_team_only_needs_team` 同判 */
    readonly ownerTeamId: string | null;
    /** 契约 `createSkillDraft.in.modelRef`。落在版本行上，见迁移里的理由 */
    readonly modelRef: string;
    /**
     * G5（2026-08-14）——可选，缺省 `[]`。落 `skill_contracts.tags`
     * （`20260814090000_g5_skill_contract_tags.sql`，`NOT NULL DEFAULT '{}'`）。
     */
    readonly tags?: readonly string[];
  }): Promise<{ readonly skillId: string; readonly versionId: string }>;
}

/**
 * #459 —— `listSkills` / `getSkillDetail` 的**读模型**。
 *
 * ## 为什么新加一个端口，而不是让既有用例返回这些字段
 *
 * `list-skills.ts` 返回 `{skillId, visibility, ownerTeamId}`——它是**可见性过滤**用例，
 * 那三个字段正是过滤判定要用的东西，不是给界面看的。`get-skill-detail.ts` 更彻底：
 * 它**只回答「能不能看」**，刻意不返回 skill 本体（文件头写着理由——判定与取数分离，
 * 判定失败时调用方结构上无法先把数据取出来）。
 *
 * ⇒ 契约的 `SkillListItem`（七字段）与 `getSkillDetail.out` 需要**第二个**取数通路。
 *   把它加进那两个用例会把「过滤判定」和「渲染取数」重新粘在一起，正是那两个文件
 *   花注释解释要避免的形状。所以：过滤判定仍归它们，本端口只负责取数。
 *
 * ## ⚠ 本端口**只有读方法**
 *
 * 同 F63 三端口、F66 版本链端口的既定纪律：方法名集合就是结构性证据。
 * 这里没有任何写方法 —— 要让一条读路径顺手改状态，得先给这个接口加一个方法，
 * 那是一次会被 review 看见的改动。写路径只有 `SkillDraftStorePort`（建）与
 * `SkillStatusStorePort`（迁移状态）两个。
 */
export interface SkillContractReadPort {
  /**
   * 一个组织下全部声明式契约 skill 的目录行，**每行都是 `Guarded`**。
   * ⚠ **不做可见性过滤**——过滤统一由 `listSkills` 用例做，基础设施层重复判定
   *   一次就是同一事实的第二份声明（`list-skills.ts` 文件头逐字）。
   *   仓储只负责「把内容包起来，让人拿不到未经判定的载荷」。
   */
  listAll(orgId: string): Promise<readonly GuardedSkillContract[]>;
  /** ⚠ 返回 `null` 只表示「不存在」；「存在但范围外」由 `discloseDecided` 判成 `Withheld`，两者由调用方折成同一个 404 */
  loadDetail(skillId: string): Promise<GuardedSkillContractDetail | null>;
  /**
   * 该 skill **此刻**的真实状态。
   *
   * ⚠ 这个方法是为修 `disable-skill.ts` 而加的：那里原本硬编码 `from: "已启用"`，
   *   于是停用一个 `草稿` 会被状态机判成合法边并持久化一次**非法状态迁移**。
   *   状态机的 `from` 必须来自库，不能来自调用方的假设。
   */
  statusOf(skillId: string): Promise<SkillLifecycleStatus | null>;

  /**
   * #1534 —— 单行等价于 `listAll()` 的一行（合并模型 A `skill_contracts` 与模型 B
   * `skills`/`skill_versions`），供 `SkillVisibilityPort.visibleTo()`（#467 挂载）
   * 与其它「按 id 直取一行、只关心它能不能被挂载」的判定使用。
   *
   * ⚠ **不是** `loadDetail` 的别名，两者结构上回答不同的问题：`loadDetail` 连同
   *   契约正文（`prompt_template` 等）一起取，而 wave2（`skills` 表）行**从不产出**
   *   声明式契约正文——`loadDetail` 对它们恒返回 `null` 是正确行为，不是这次要修的
   *   问题（`skill-catalog-live.tsx` 的 `WAVE2_BACKED_DUTY_MARKER` 注释已经把「查看
   *   契约」换成了「编辑源码」正是因为这一点）。挂载判定只需要 `status` /
   *   `currentVersionId` / 可见范围三样，`loadMountableRow` 是给这三样单开的取数口，
   *   不途经契约正文那部分从来取不到的东西。
   *
   * ⚠ 挂载判定原先直接复用 `loadDetail`，于是一个通过「从 GitHub 导入」落地的
   *   wave2 skill 在 chat 里 `#` 挂载必然 `SKILL_NOT_FOUND`（#1534 实测复现）——
   *   `loadDetail` 对它必然返回 `null`，而调用方（`skill-mount.controller.ts`）把
   *   「不存在」与「查不到详情」当成了同一件事。两件事在这里被分开成两个方法。
   */
  loadMountableRow(skillId: string): Promise<GuardedSkillContract | null>;
}

/** `SkillContractReadPort.listAll` 的行。字段与契约 `SkillListItem` 一一对应。 */
export interface SkillContractRow {
  readonly skillId: string;
  readonly name: string;
  readonly duty: string;
  readonly source: SkillOriginTag;
  readonly status: SkillLifecycleStatus;
  readonly visibility: "org-wide" | "team-only";
  readonly ownerTeamId: string | null;
  readonly currentVersionId: string | null;
  /** G5（2026-08-14）。wave2（`skills` 表来源）行恒为 `[]`——见 `listAll()` 的映射注释。 */
  readonly tags: readonly string[];
}

/** `getSkillDetail` 的取数结果。⚠ `contract` 取的是**最新版本**的声明正文。 */
export interface SkillContractDetail {
  readonly row: SkillContractRow;
  readonly contract: DeclarativeContract;
  /**
   * **本响应正文所属的那一版**（#552）。
   *
   * ⚠ 与 `row.currentVersionId`（＝**生效**版本，草稿期恒 null）**不是同一件事**，
   *   这正是契约把 `currentVersionId` 同时放在 `getSkillDetail.out` 顶层与
   *   `SkillListItem` 里面的原因：同一个事实声明两遍是本仓九次漂移的形状，
   *   两个不同的事实各有一处才是它该有的读法。
   *
   * ⚠ 没有它，**评审这条链在界面上无法开始**：契约的三条门禁路径都挂在
   *   `/skill-versions/:versionId/...` 上，而一个刚建好的草稿其 `生效版本` 是 null，
   *   于是前端拿不到任何 versionId。这个字段是那条链唯一不违背 ADR-020
   *   （不新增契约外路由）的取数口。**该读法已在 PR 里请签核人复看。**
   */
  readonly bodyVersionId: string;
}

/**
 * 判定一次可见性所需的**最小事实**。
 *
 * ⚠ 刻意放在 `Guarded` **外面**：判定函数需要 `scope` / `ownerTeamId` 作输入，
 *   而 `Guarded` 的载荷在判定之前是取不出来的——两者都放进去会变成
 *   「要先拿到载荷才能判断能不能拿载荷」。同 `identity/capability-ports.ts`
 *   的 `GuardedCapability.facts` 一模一样的分法，不另发明一种。
 *
 * ⚠ 这两个字段**本身不是租户内容**：它们是「这一行对谁可见」的元数据，
 *   泄露它们不等于泄露 skill 的名字/职责/契约正文——那些都在载荷里。
 */
export interface SkillVisibilityFacts {
  readonly scope: "org-wide" | "team-only";
  readonly ownerTeamId: string | null;
}

/**
 * 目录行的**受保护**形态。
 *
 * ⚠ 载荷只能经 `discloseDecided(row, decision)` 取出——「忘了判定」因此是一个
 *   **类型错误**，不是一次疏漏（`permission-filter.ts` 的设计意图）。
 *   这正是 `lint-permission-paths` 要求的那条正门：R7「权限沿数据路径传播」。
 */
export interface GuardedSkillContract {
  readonly facts: SkillVisibilityFacts;
  readonly row: Guarded<SkillContractRow>;
}

/** 同上，详情版。 */
export interface GuardedSkillContractDetail {
  readonly facts: SkillVisibilityFacts;
  readonly detail: Guarded<SkillContractDetail>;
}

/**
 * 状态迁移的**唯一落库面**。
 *
 * ⚠ 只有 `applyTransition` 一个方法，且它**同时带 `from` 和 `to`**：
 *   实现方按 `WHERE status = from` 更新，所以「读到的状态」与「写下去时的状态」
 *   不一致时这次更新影响 0 行，而不是覆盖掉别人刚写的状态。
 *   一个只收 `to` 的 `setStatus(skillId, status)` 会让并发的两次停用/恢复互相顶替，
 *   而且**没有任何地方能看出来**——那正是 `SKILLS_FORBIDDEN_ROUTES` 想堵的形状
 *   在存储层的等价物。
 */
export interface SkillStatusStorePort {
  applyTransition(input: {
    readonly skillId: string;
    readonly from: SkillLifecycleStatus;
    readonly to: SkillLifecycleStatus;
    readonly archived: boolean;
  }): Promise<{ readonly changed: boolean }>;
}

/**
 * 安全审计。⚠ I-23 逐字要求绕过尝试**写审计**——
 * 一次没有留痕的拒绝，事后无法与「从未发生」区分。
 *
 * ⚠ `"skill-member-self-mount-attempt"`（F65）：组员/未获下放权限的组长直调
 *   `mountSkillToThread` 被服务端拒绝时写入——同 I-23 同一道纪律在挂载场景的落点。
 */
export interface SecurityAuditPort {
  record(event: {
    readonly kind:
      | "skill-gate-bypass-attempt"
      | "skill-source-tag-write-attempt"
      | "skill-member-self-mount-attempt"
      /** F67：AI 试图自行晋升入库（E2/V5）——AI 可提名，不可自行批准/入库。 */
      | "skill-ai-self-promotion-attempt";
    readonly principalId: string;
    readonly detail: string;
  }): Promise<void>;
}

/* ═══════════════════ F63：绑定与两级编排 ═══════════════════ */

/**
 * **「不回写」的结构性落点在这三个端口的方法名里**（I-17）。
 *
 * · 模板本体：`WorkflowTemplateReadPort` **只有 `load`**；
 * · 组织模板：`OrgTemplateCreatePort` **只有 `create`**；
 * · 可写的只有 `ProjectOrchestrationStorePort`，而它只认 `projectId`。
 *
 * ⇒ skill 束的 application 层**拿不到任何能改已存在模板的东西**。
 *   这比一条「用例里别去写模板表」的纪律强的地方在于：要回写，得先给端口加一个方法，
 *   而 `instance-override-no-writeback.test.ts` 逐字扫这三个接口的方法名集合，
 *   多出一个就红。规范没有脚本视为未落地 —— 这就是那个脚本。
 *
 * ⚠ 三个端口刻意**分成三个**而不是合成一个 `OrchestrationRepository`：
 *   合成之后，「读模板」「写实例」「建新模板」共用一个对象，
 *   方法名集合这条断言立刻失去分辨力，回写只需在同一个对象上多调一个方法。
 */
export const TEMPLATE_PORTS_ALLOWED_METHODS = {
  WorkflowTemplateReadPort: ["load"],
  OrgTemplateCreatePort: ["create"],
  ProjectOrchestrationStorePort: ["load", "save"],
} as const;

/** 模板本体：**只读**。没有 `save`、没有 `update`、没有 `patch`。 */
export interface WorkflowTemplateReadPort {
  load(templateId: string): Promise<WorkflowTemplateBody | null>;
}

/** 项目实例编排：唯一可写的编排面，且入口只认 `projectId`。 */
export interface ProjectOrchestrationStorePort {
  load(projectId: string): Promise<ProjectOrchestration | null>;
  save(orchestration: ProjectOrchestration): Promise<void>;
}

/**
 * `[另存为组织模板]`：**只有 create**。
 *
 * ⚠ 返回的 `templateId` 由实现方分配，用例断言它 ≠ 来源模板 id ——
 *   一个「create 了一个同 id 的东西」的实现就是覆盖，只是换了个动词。
 */
export interface OrgTemplateCreatePort {
  create(body: WorkflowTemplateBody): Promise<{ readonly templateId: string }>;
}

/**
 * 绑定可选池的判定（UC-3.2 R3 步骤 3：`已启用` ∩ 可见性范围覆盖当前用户）。
 *
 * ⚠ 返回 `null` 同时表示「不存在」与「可见性范围外」——**这是故意的**：
 *   I-14 要求范围外**不返回其存在性**（404 非 403）。让端口区分两者，
 *   调用方迟早会把区别透出去，那就是一次存在性泄露。
 */
export interface SkillVisibilityPort {
  visibleTo(input: {
    readonly skillId: string;
    readonly principalId: string;
  }): Promise<{
    readonly status: SkillLifecycleStatus;
    /**
     * ⚠ **nullable，而它必须是（#552）。**
     *
     * 这里原本是 `string`，于是 `skill-mount.controller.ts` 的适配把
     * `currentVersionId === null` 折成了「不存在」（返回 `null` ⇒ `SKILL_NOT_FOUND`）。
     * 那处注释当时写着「实践中这一支到不了——`已启用` 蕴含有生效版本」，
     * **那句话当时为真**：#552 之前没有任何 skill 离得开草稿，所以能被挂载的只有
     * 种子里那条已启用的。
     *
     * #552 让草稿真的能被用户拿去挂了，条件就变了：**未获批准的 skill 恒
     * `currentVersionId === null`**，于是使用者挂自己那条待审核的 skill 会被告知
     * 「这个 skill **不存在**」——而它明明就在他自己的目录里列着。
     * 正确答案是 `SKILL_NOT_ENABLED`（「只有已启用的可挂载，它现在是待审核」）。
     *
     * ⇒ 端口如实返回 `null`，让 `mountSkillToThread` 先判 `status`、再要版本号。
     *   「有没有生效版本」与「存不存在」是两件事，折成一件会让界面说假话。
     */
    readonly currentVersionId: string | null;
  } | null>;
}

/* ═══════════════════ F64：编排一次三视图与待办 / 现场自动挂载 / 孤立绑定 ═══════════════════ */

/**
 * 角色格→待办的**下游发布**（跨束边，`usecases.md`「TodoPublisher | 角色格 → 待办，
 * 异步可重试，不阻塞编排保存 | outbox + worker（11-board）」）。
 *
 * ⚠ 单条失败不抛出中断整批——`publish` 用返回值表达成败，让 use case 能继续处理
 *   剩下的格子、把这一条计进 `failed`（E4/V12：「编排仍保存成功」）。
 */
export interface TodoPublisherPort {
  publish(input: {
    readonly agendaSegmentId: string;
    readonly role: string;
    readonly text: string;
    /** ⚠ D-39：待办负责人恒为人。这个字段的值**只能来自 `RoleAssigneePort`**，
     *   与下面 `executorAgentId` 的来源（绑定表的 agent-output 槽）结构性不相交。 */
    readonly assigneePrincipalId: string;
    readonly executorAgentId: string | null;
  }): Promise<{ readonly ok: true; readonly todoId: string } | { readonly ok: false }>;
}

/**
 * 「这场项目里，这个角色此刻是谁」——跨束边（人员归属属 identity/11-board，不属 skill 束）。
 *
 * ⚠ 刻意与 `executorAgentIdFor`（读绑定表的 agent-output 槽）分离成两个互不相交的取数通路：
 *   一个只能问出人，一个只能问出 agent，D-39 的「恒为人」因此是**结构性**的——
 *   要让 agent 的 id 混进 `assigneePrincipalId`，得先把两个端口的返回值接反，
 *   那是一次会被类型检查器和 review 同时看见的改动。
 */
export interface RoleAssigneePort {
  assigneeOf(input: {
    readonly projectId: string;
    readonly agendaSegmentId: string;
    readonly role: string;
  }): Promise<{ readonly principalId: string } | null>;
}

/**
 * 挂载解析时的依赖健康度（R3 步骤 7 的 E2：模型/MCP 依赖不可用时**明确告知，不静默跳过**）。
 * ⚠ 返回值直接落进 `mounts[].disabledReason`——不可用时该条**仍出现在列表里**，
 *   不是被过滤掉（这条纪律与 `listMountableSkills` 的 `disabledReason` 同口径）。
 */
export interface MountHealthPort {
  checkAvailability(
    skillId: string,
  ): Promise<{ readonly available: true } | { readonly available: false; readonly reason: string }>;
}

/** A5/V8：一个组织下全部**已启用** skill 的读端口（`listIdleSkills` 用）。 */
export interface OrgSkillCatalogPort {
  listEnabled(orgId: string): Promise<readonly string[]>;
}

/** A5/V8：该组织范围内**已被任一环节绑定过**的 skill id 集合。 */
export interface AllOrchestrationsPort {
  boundSkillIds(orgId: string): Promise<readonly string[]>;
}

/* ═══════════════════ F65：对话内临时加减 ═══════════════════ */

/**
 * 线程临时挂载的读写面。**入口只认 `threadId`**（I-18）——
 * 与 F63 的 `ProjectOrchestrationStorePort` 只认 `projectId` 同一种落法：
 * 这个端口结构上拿不到「别的线程」或「蓝本」，要让一次挂载影响到它们，
 * 得先给端口加参数，那是一次会被 review 看见的改动。
 *
 * ⚠ 这里**没有**按 `agendaSegmentId`/`projectId` 读写的方法：
 *   本挂载与蓝本绑定（`ProjectOrchestrationStorePort`）是两个互不相交的存储面，
 *   混成一个会让「来源可区分」失去结构性的落点。
 */
export interface ThreadMountStorePort {
  load(threadId: string): Promise<readonly ThreadSkillMount[]>;
  save(threadId: string, mounts: readonly ThreadSkillMount[]): Promise<void>;
}

/**
 * `save()` 抛这个：两个真正并发的挂载请求都在同一份 `load()` 快照上通过了
 * 用例层的乐观锁比对（那道比对只在内存里发生），实现层的唯一索引
 * （`thread_skill_mounts_active_skill_uniq`）替它们分出了先后。
 *
 * ⚠ 定义在 application 层，不是 infrastructure 层：这条错误要被
 *   `mount-skill-to-thread.ts`（application）捕获并翻译成 `SkillErrorCode`，
 *   而 application 不能 import infrastructure（洋葱方向）。实现（`pg-thread-mount-store.ts`）
 *   反过来 import 这里，方向对了。
 */
export class ThreadMountConcurrentMountError extends Error {
  constructor(readonly skillId: string) {
    super(`skill ${skillId} 已被另一次并发请求挂载到同一线程，拒绝写入第二条活跃挂载`);
  }
}

/* ═══════════════════ F66：版本链 / 引用枚举 / 停用恢复 / 硬删 ═══════════════════ */

/**
 * 版本链的落库面。⚠ **只有 `load` / `save` 两个方法**——同 F63 三端口的纪律，
 * 方法名集合就是「不能就地改写某一版」的结构性证据：要绕过不可变，
 * 得先给这个接口新增一个 `patch` 之类的方法，那是一次会被 review 看见的改动。
 */
export interface SkillVersionStorePort {
  loadChain(skillId: string): Promise<readonly SkillVersionSnapshot[]>;
  saveChain(skillId: string, history: readonly SkillVersionSnapshot[]): Promise<void>;
}

/**
 * 引用枚举三类的取数通路，**刻意分成三个方法**（同 F64 `TodoPublisherPort` 一带的纪律）：
 * 合成一个 `referencesOf()` 会让「进行中项目 / 蓝本绑定 / agent 挂载」这三类
 * 在契约层面失去分辨力，调用方也更容易在实现时把它们悄悄糊成一次查询。
 * ⚠ 已知空白：当前 `list-references.ts` 仍用 `Promise.all` 等三者一起返回，
 *   单类失败会让整个调用失败，尚未做到「一类挂掉不影响另外两类」的隔离——
 *   留三个独立方法是为将来补这条隔离铺路，本 feature 尚未实现它。
 */
export interface ReferenceEnumerationPort {
  inFlightProjects(skillId: string): Promise<readonly string[]>;
  templateBindings(skillId: string): Promise<readonly string[]>;
  agentMounts(skillId: string): Promise<readonly string[]>;
}

/** 停用前置清单落库（供 `disableSkill` 校验 `referenceSnapshotId` 是否是最新一次）。 */
export interface ReferenceSnapshotStorePort {
  save(snapshot: ReferenceSnapshot): Promise<void>;
  loadLatest(skillId: string): Promise<ReferenceSnapshot | null>;
}

/** 硬删/停用判定需要知道来源标记（`CC` ⇒ `BUILTIN_NOT_DELETABLE`，I-13）。 */
export interface SkillSourcePort {
  sourceOf(skillId: string): Promise<SkillOriginTag | null>;
}

/* ═══════════════════ F62：评审职能 / 可见性范围 / 满意度 ═══════════════════ */

/**
 * **组织管理员指派的评审职能**解析（I-5）。⚠ 本端口只回答「这个人此刻是什么职能」，
 * 不做鉴权判断——「职能对不对／能不能自审」的判断在
 * `domain/skill/review-authorization.ts` 的纯函数里，端口只负责取数。
 */
export interface ReviewerFunctionPort {
  functionOf(principalId: string): Promise<ReviewerFunctionValue | null>;
  /**
   * 该组织内，除 `excludePrincipalId` 外是否**还有至少一名**方法论审核人。
   * ⚠ 只在「提交人＝审核人」分支下才需要回答这个问题（`NO_SECOND_REVIEWER` 的判据，A4）——
   *   刻意不做成「列出全部审核人」，列表本身对本次判定是多余信息。
   */
  anotherMethodologyReviewerExists(orgId: string, excludePrincipalId: string): Promise<boolean>;

  /**
   * issue #852 delta（skill-reviewer-function-assignment）—— 组织管理员任命入口的
   * 落库面。`functionOf` 在 #552 就有了读方，这三个方法补上从未存在过的**写**方。
   *
   * ⚠ 鉴权（调用者是不是本组织 admin）**不在这里判断**——同 `functionOf` 的既有分工，
   *   端口只负责取数/落库，判定住在 `application/auth/assign-skill-reviewer-function.ts`
   *   与 `.../revoke-skill-reviewer-function.ts`（controller `requireAdminRole` 之后
   *   第二道，同 `removeOrgMember` 的既有纪律：判断不能只靠 HTTP 层一次）。
   */
  assignReviewerFunction(input: {
    readonly principalId: string;
    readonly reviewerFunction: ReviewerFunctionValue;
    readonly assignedBy: string;
  }): Promise<{ readonly assignedAt: string }>;
  /** `revoked: false` ＝ 目标人此前从未被指派过（`NOT_ASSIGNED` 的判据），不是失败。 */
  revokeReviewerFunction(principalId: string): Promise<{ readonly revoked: boolean }>;
  listReviewerFunctions(): Promise<
    readonly {
      readonly principalId: string;
      readonly reviewerFunction: ReviewerFunctionValue;
      readonly assignedBy: string;
      readonly assignedAt: string;
    }[]
  >;
}

/* ═══════════════════ #552：两道门禁的落库面 ═══════════════════ */

/**
 * 一个版本在**评审这件事上**需要知道的最小事实。
 *
 * ⚠ 里面有 `submitterId`，而它**不是**请求体里的字段：`review-skill-version.ts` 的入参注释
 *   逐字写着「来自版本记录，不是入参可篡改的字段」。一个从请求体读提交人的实现，
 *   会让 `SELF_REVIEW_FORBIDDEN` 变成一条报一个别人的 id 就能绕过的规则。
 */
export interface SkillVersionForReview {
  readonly versionId: string;
  readonly skillId: string;
  readonly versionNumber: number;
  readonly state: "草稿" | "待审核" | "已生效" | "已归档" | "待上线";
  readonly submitterId: string;
  readonly contract: DeclarativeContract;
}

/**
 * 门禁第一道的落库面。
 *
 * ⚠ `saveScan` **不返回放行与否**，`latestScan` 也不做判定：放行与否是
 *   `domain/skill/security-gate.ts` 的事，这里只负责让那个判定有真实输入。
 * ⚠ **append-only**：没有 `update`，也没有 `clear`。重扫一版是新增一条记录，
 *   于是「曾经被判拒、后来改好了」在数据上仍然看得见（I-3 的倒查要的正是这个）。
 */
export interface SecurityScanStorePort {
  saveScan(input: {
    readonly scanId: string;
    readonly skillId: string;
    readonly versionId: string;
    readonly result: SecurityScanResult;
    readonly scannedBy: string;
  }): Promise<void>;
  /** ⚠ `null` ＝ **从未扫过**，不是「扫过但没过」。两者必须可分辨（`security-gate.ts` 逐字）。 */
  latestScan(versionId: string): Promise<SecurityScanResult | null>;
}

/**
 * 门禁第二道（人工）的落库面。
 *
 * ⚠ 同样 append-only 且**没有任何方法能写 `Skill.status`**。这是
 *   `SKILLS_FORBIDDEN_ROUTES` 在存储层的对应物：一条评审记录本身推不动状态机，
 *   状态迁移只能走 `SkillStatusStorePort.applyTransition`（它带 `from`，做乐观并发）。
 */
export interface MethodologyReviewStorePort {
  saveReview(input: {
    readonly reviewRecordId: string;
    readonly skillId: string;
    readonly versionId: string;
    readonly submitterId: string;
    readonly reviewerId: string;
    readonly decision: "approve" | "reject";
    readonly reason: string;
    readonly riskAcks: readonly string[];
  }): Promise<void>;
  /** I-3 的倒查：这一版有没有人工审核记录、结论是什么。`null` ＝ 还没有人审。 */
  latestReview(
    versionId: string,
  ): Promise<{ readonly approved: boolean; readonly reviewRecordId: string } | null>;
}

/**
 * 版本自身的生命周期（`SkillVersion.state`）。
 *
 * ⚠ 与 `Skill.status` 是**两个字段**，domain.md §2 逐字要求「不得互相推导」。
 *   所以这里是一个独立端口，而不是给 `applyTransition` 多加一个参数——合进去的那一刻，
 *   两个字段就只剩一次写入，第二天就没人分得清它们本来是两件事。
 * ⚠ `releaseVersion` 同时置 `state = 已生效` 与该 skill 的 `current_version_id`：
 *   一个「已生效但不是当前版本」的版本行会让挂载时 `ThreadSkillMount.versionId` 取不到值
 *   （`skill-mount.controller.ts` 对 `currentVersionId === null` 折成 `SKILL_NOT_FOUND`）。
 *   两者必须在同一个事务里动，所以是**一个**方法而不是两个。
 */
export interface SkillVersionLifecyclePort {
  loadVersionForReview(versionId: string): Promise<SkillVersionForReview | null>;
  /** 提交进人工门禁：版本 `草稿 → 待审核`。⚠ 带 `from`，同 `applyTransition` 的乐观并发。 */
  markVersionSubmitted(versionId: string): Promise<{ readonly changed: boolean }>;
  /** approve：版本 `待审核 → 已生效` ＋ 该 skill 的当前生效版本指向它。 */
  releaseVersion(versionId: string): Promise<{ readonly changed: boolean }>;
  /** reject：版本 `待审核 → 草稿`（`rejectedToDraftLosesDistinction()` 的代价在这条边上）。 */
  returnVersionToDraft(versionId: string): Promise<{ readonly changed: boolean }>;
}

/**
 * 四入口共用的可见性范围读端口（I-14）。
 *
 * ⚠ 与上面 `SkillVisibilityPort`（F63：可绑定池判定，只在 `已启用` 上生效）**不是同一个端口**：
 *   那个端口回答「这个 skill 现在能不能被绑定」，这个端口回答
 *   「这个 skill 配置的可见性范围是什么、归哪个团队」——可见性范围与评审/启用状态是
 *   两个独立字段，不合并（notes 逐字）。
 * ⚠ 返回 `null` 表示「不存在」——由调用方统一折成 `SKILL_NOT_FOUND`（404 非 403，I-14）。
 */
export interface SkillVisibilityScopePort {
  scopeOf(
    skillId: string,
  ): Promise<{ readonly visibility: "org-wide" | "team-only"; readonly ownerTeamId: string | null } | null>;
}

/** 满意度 👍/👎 计数读端口。⚠ 只读计数，**不算比值**——比值口径单源在 domain 层（O-37）。 */
export interface SatisfactionCountsPort {
  countsOf(skillId: string): Promise<{ readonly up: number; readonly down: number }>;
}

/* ═══════════════════ F67：方法晋升生成 skill（phase-1 接收端）═══════════════════ */

/**
 * 晋升审批人是否为 AI（E2/V5：**AI 可提名，不可自行晋升入库**，
 * 任何自动入库路径必须被服务端拒绝）。
 */
export interface PromoterKindPort {
  kindOf(principalId: string): Promise<"human" | "ai">;
}

/**
 * 源知识是否含客户机密、须先过脱敏闸门（D-16/V7）。
 * ⚠ 只回答「要不要脱敏」，**不做脱敏本身**——脱敏稿的生成与确认属知识侧（14-brain），
 *   本域只在闸门未过时拒绝生成 skill。
 */
export interface RedactionGatePort {
  requiresRedaction(knowledgeItemId: string): Promise<boolean>;
}

/**
 * 晋升生成的落库面：**直接落 `待审核`**（自动生成 ≠ 自动发布，跳过 `草稿`——
 * 晋升本身已完成「提交」这一步，但仍需两道门禁齐全才能启用，见 `security-gate.ts`）。
 *
 * ⚠ 只有 `savePendingReview` 一个方法，**没有** `publish` / `enable`：
 *   落库面结构上拿不到把它直接置为已启用的能力，AC2 因此是结构性的一部分，
 *   不止是调用方纪律。
 */
export interface PromotionSkillStorePort {
  savePendingReview(input: {
    readonly orgId: string;
    readonly knowledgeItemId: string;
    readonly contract: DeclarativeContract;
    /** 恒为「晋升生成」——由 `assignSourceByEntry("promotion")` 产生，不是入参决定的 */
    readonly source: SkillOriginTag;
  }): Promise<{ readonly skillId: string; readonly versionId: string }>;
}

/**
 * `PromotionLink` 的落库面。**双向都要能查到**（I-22）：
 * `loadBySkillId` 供 `getPromotionProvenance`（skill → 源知识/源决策）；
 * `loadByKnowledgeItemId` 供 `onSourceKnowledgeStateChanged`（源知识 → skill）。
 * 两个方法读的是**同一份记录**，不是两张各自维护的表——那正是「同一份资产两个
 * 互不关联副本」的第一次分岔点。
 */
export interface PromotionLinkStorePort {
  save(link: PromotionLink): Promise<void>;
  loadBySkillId(skillId: string): Promise<PromotionLink | null>;
  loadByKnowledgeItemId(knowledgeItemId: string): Promise<PromotionLink | null>;
}

/**
 * 源知识状态变化 → skill 侧效果的落库面（E5/E6/E7）。
 *
 * ⚠ 三个方法对应三种效果，**刻意分开**（同 `TodoPublisherPort` 一带的纪律）：
 *   合成一个 `applyEffect()` 会让「标注 / 停用 / 发新版」在契约层面失去分辨力。
 */
export interface SourceKnowledgeLinkageStorePort {
  /** `待复核`：标「源方法已过期」，**不改变 `Skill.status`**（D-j 待人类裁决）。 */
  annotateExpired(skillId: string): Promise<void>;
  /** `被推翻` / `被撤销`：自动转已停用，不硬删；只改 `Skill.status`，不碰绑定/挂载记录。 */
  disable(skillId: string): Promise<void>;
  /** `被替代`：取当前生效版本的契约正文，作为发新版的起点。无生效版本时返回 `null`。 */
  currentEffectiveContract(
    skillId: string,
  ): Promise<{ readonly content: DeclarativeContract } | null>;
}

/* ═══════════════════ F68：改进反馈与版本触发 ═══════════════════ */

/**
 * 消息级评价的落库面（`rateMessage` 用）。⚠ **只有 `findByIdempotencyKey` / `save`**——
 * 没有 `update`：一条评价一旦落库不可再改（对照 F66 版本快照「写了就不改」的同一纪律），
 * 撤销/改评价（R10「待确认」）留给未来另起一个方法，不在这里悄悄允许。
 */
export interface RatingRepositoryPort {
  findByIdempotencyKey(key: string): Promise<RatingRecord | null>;
  save(record: RatingRecord): Promise<void>;
  /** 供满意度/聚合读取某 skill 名下全部评价（含未归因的，由调用方按 `deriveSkillSatisfactionCounts` 过滤）。 */
  listBySkillId(skillId: string): Promise<readonly RatingRecord[]>;
}

/**
 * F176 —— 一条 AI 消息的归因链，**由服务端查出来**。
 *
 * ⚠ 这个端口存在的全部理由是：`rateMessage` 的用例入参里有 `attribution`，
 *   而那份 attribution **绝不能来自请求体**。前端能传归因，就等于任何用户都能
 *   伪造某个 skill 的满意度——而满意度是 UC-3.6 整条改进闭环的输入。
 *   契约的 `rateMessage.in` 本身已经不含 attribution（`{ messageId, verdict, reason }`
 *   且 `.strict()`），这个端口是把「那么它从哪来」这个问题的答案钉在一处。
 *
 * ⚠ 返回 `null` ⇒ 这条消息不是某次 agent run 的产物（人类发的消息、或早于
 *   `chat_messages.agent_run_id` 的历史消息）。调用方应当拒绝评价，
 *   **不是**编一个 attribution 出来。
 */
export interface MessageAttributionPort {
  /**
   * ⚠ 实现必须只认 `author_kind = 'agent'` 的消息，并沿 `chat_messages.agent_run_id`
   *   →`agent_runs` 取 `agent_id` / `skill_version_ids`。
   *   「一次 run 用了几个 skill」与「这条评价归给哪个 skill 版本」不是同一个问题，
   *   两者的接缝规则写在实现的文件头里（恰好一个才归因，见 I-20）。
   */
  resolveForMessage(messageId: string): Promise<RatingAttribution | null>;
}

/** 数据质量报表落库面（E1：缺归因的评价不得静默消失，必须可被列出）。 */
export interface DataQualityReportPort {
  record(entry: DataQualityEntry): Promise<void>;
}

/**
 * 聚合建议的人工归类落库面。⚠ 只有 `setCategory` / `categoryOf`——
 * 聚合本身（`aggregateSuggestions`）是纯函数重算出来的投影，不落库；
 * 落库的只有「人对哪个结构键做了什么归类」这一件事（R7 的人工归类字段）。
 */
export interface SuggestionCategoryStorePort {
  setCategory(structuralKey: string, category: SuggestionCategory): Promise<void>;
  categoryOf(structuralKey: string): Promise<SuggestionCategory | null>;
}

/**
 * 改进提案的落库面。⚠ **没有 `publish` / `setEffective`**——
 * 与 F67 `PromotionSkillStorePort` 同一条纪律：落库面结构上拿不到把提案
 * 直接置为生效的能力，「未经复核不得上线」因此不止是调用方纪律，也是结构性的。
 * 上线走 `SkillVersionStorePort`（复用 F66 `releaseVersion`），不是这个端口的方法。
 */
export interface ImprovementProposalStorePort {
  save(proposal: {
    readonly proposalId: string;
    readonly skillId: string;
    readonly baseVersionId: string;
    readonly draftVersionId: string;
    readonly schemaBreaking: boolean;
    readonly machineGenerated: true;
    readonly humanEdits: number;
  }): Promise<void>;
}

/* ═══════════════════ DI 令牌（#459）═══════════════════ */

/**
 * 令牌与端口同处 application 层：composition root（`kernel.module.ts`）与
 * `interface` 层 import 它，而 `infrastructure` 只实现接口、不拥有令牌
 * （依赖倒置——同 `DATABASE_PORT` 的既定放法）。
 *
 * ⚠ 只有**一个**令牌，尽管上面是五个端口：它们由同一个请求级仓储实现，
 *   而那个仓储必须绑定租户才能构造（见 `ScopedPgSkillContractRepository`）。
 *   给每个端口发一个令牌会让 controller 拿到五个**各自未绑定租户**的对象，
 *   那正是要结构性排除掉的东西。
 */
export const SKILL_CONTRACT_REPOSITORY = Symbol("SkillContractRepository");

/** `SubmitterGrantsPort` 的令牌。实现见 `infrastructure/skill/skill-gate-adapters.ts`。 */
export const SKILL_SUBMITTER_GRANTS = Symbol("SkillSubmitterGrants");

/** `SecurityAuditPort` 的令牌。同上。 */
export const SKILL_SECURITY_AUDIT = Symbol("SkillSecurityAudit");

/**
 * `ThreadMountStorePort` 的**工厂**令牌（#467）。实现见
 * `infrastructure/skill/pg-thread-mount-store.ts`。
 *
 * ⚠ 与 `SKILL_CONTRACT_REPOSITORY` 出于同一个理由发的是工厂而不是端口本身：
 *   租户只能来自已认证的 principal（契约的 `mountSkillToThread.in` 里没有 `orgId`），
 *   所以「未绑定租户的挂载仓储」这个东西不该存在。
 */
export const THREAD_MOUNT_STORE = Symbol("ThreadMountStore");

/** 已绑定租户的线程挂载仓储工厂。 */
export interface ThreadMountStoreFactory {
  forOrg(orgId: string): ThreadMountStorePort;
}

/**
 * 请求级仓储的**工厂端口**（#459）。
 *
 * ⚠ `interface` 层只认这个类型，**不 import `infrastructure/`**：
 *   `lint-arch-deps` 逐字禁止那个方向，而它禁得对——controller 一旦知道
 *   `PgSkillContractRepository` 这个名字，「换一个实现」就变成了改 controller。
 *
 * ⚠ 工厂只有 `forOrg` 一个方法：**拿不到一个「没有租户的仓储」**。
 *   契约里按 id 直取的操作入参没有 `orgId`，租户只能来自已认证的 principal，
 *   所以「未绑定租户的仓储」这个东西根本不该存在。
 */
export interface SkillContractRepositoryFactory {
  forOrg(orgId: string): SkillContractRepository;
}

/**
 * 一个请求内、已绑定租户的仓储：九个端口的交集。
 *
 * ⚠ 后四个（#552）与前五个（#459）同处一个交集，理由与那五个逐字相同：它们读写的是
 *   **同一组表、同一个租户事务**，而端口仍然分开——用例只拿得到自己声明的那个端口的方法，
 *   「方法名集合就是结构性证据」那条纪律靠的是 application 层看到的类型。
 * ⚠ `ReviewerFunctionPort` 也在这里，而它读的是 `skill_reviewer_functions`：
 *   同一个租户会话，同一次请求。给它单发一个令牌会让 controller 拿到一个
 *   **未绑定租户**的职能解析器——那是最难查的一类越权（见 `SkillContractRepositoryFactory`）。
 */
export type SkillContractRepository = SkillDraftStorePort &
  SkillContractReadPort &
  SkillStatusStorePort &
  SkillVisibilityScopePort &
  ReferenceSnapshotStorePort &
  SecurityScanStorePort &
  MethodologyReviewStorePort &
  SkillVersionLifecyclePort &
  ReviewerFunctionPort;

/**
 * 组织内 skill 重名。
 *
 * 定义在 application 层而不是 infrastructure，是为了让 controller 能 `catch` 它
 * 而不必 import `infrastructure/`（同上，`lint-arch-deps`）。
 *
 * ⚠ **契约缺口（已上报）**：`createSkillDraft.err` 里没有表达「重名」的码，
 *   而 coord-main 裁决「一个 skill 目录」⇒ 必须投影进 `capability_listings`，
 *   那张表的 `UNIQUE (org_id, kind, name)` 让重名在结构上不可表示。
 *   处置是 fail closed 且可观察（409 + 明确 message），**不**复用一个语义不符的
 *   契约错误码——复用会让这个缺口从此看不见。
 */
export class SkillNameConflictError extends Error {
  constructor(readonly skillName: string) {
    super(`该组织内已存在同名 skill：${skillName}`);
    this.name = "SkillNameConflictError";
  }
}

/**
 * F176 —— 消息级评价仓储的**工厂**令牌。
 *
 * 与 `SKILL_CONTRACT_REPOSITORY` 同一个理由发工厂而不是端口本身：契约的
 * `rateMessage.in` 里没有 `orgId`（只有 `messageId`），租户只能来自已认证的 principal。
 * 「未绑定租户的评价仓储」这个东西不该存在——它能写进别人组织的评价。
 */
export const MESSAGE_RATING_REPOSITORY = Symbol("MessageRatingRepository");

/** 一个请求内、已绑定租户的评价仓储：三个端口的交集（同一组表、同一次租户会话）。 */
export type MessageRatingRepository = RatingRepositoryPort &
  DataQualityReportPort &
  MessageAttributionPort;

export interface MessageRatingRepositoryFactory {
  forOrg(orgId: string): MessageRatingRepository;
}
