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
  }): Promise<{ readonly skillId: string; readonly versionId: string }>;
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
      | "skill-member-self-mount-attempt";
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
  }): Promise<{ readonly status: SkillLifecycleStatus; readonly currentVersionId: string } | null>;
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
