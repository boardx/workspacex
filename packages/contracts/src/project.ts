/**
 * 契约束 `project` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份生成四样东西，任何一样都不许手写第二份——
 *   ├─→ 后端 DTO + NestJS 全局 ValidationPipe 的运行时校验
 *   ├─→ 前端 client 类型
 *   ├─→ OpenAPI（对外文档 + 契约 diff 门控）
 *   └─→ 前端 mock 数据
 *
 * 覆盖 feature：F116…F128（phase-01 `project` 域，合计 56 点）
 * 依据 UC：`00-project/uc-00-1 / uc-00-2 / uc-00-3`
 * 领域模型见 `phases/phase-01-run-a-project/contracts/project/domain.md`（I-P1…I-P45）
 * 用例接口见 同目录 `usecases.md`（UC-P1…UC-P10）
 *
 * ## 本束的形状由两批人类裁决定死（裁决原文是权威，本文只写落地结果）
 *   · `requirements/00-project/OPEN-QUESTIONS.md` 12 条（2026-07-30）
 *   · `contracts/project/domain.md` 第八节 U-1…U-9（2026-07-30 16:34:55+08:00）
 *
 * ## 核心不变量（domain.md 有断言方式）
 *   · **三类独立容器**：`projects` 是超类型（**只有** id / org_id / name / status / kind，I-P33），
 *     `workshops` / `research_projects` / `user_insights` 三张 1:1 子类型表承载各自行为
 *   · **子类型互斥**由 `UNIQUE(id, kind)` + 子表复合外键保证（I-P34 / U-9 A），
 *     **不是**靠「大家都小心」——纯 PK+FK 下一个容器同时挂两张子表完全合法
 *   · **四种项目角色只属工作坊**（I-P6 + 人类 2026-07-30 收窄裁决）；
 *     研究项目 / 用户洞察各自一张成员表、只有 `owner` / `collaborator` 两档（U-1 B）
 *   · **归档不删除任何东西**（I-P38）；`deleteProject` **不存在**（I-P40 / Q-9），
 *     它的交付物是 `tests/no-forbidden-routes.test.ts` 里一条断言它不存在的测试
 *   · **同一工作坊内 `active` 议程环节至多一个**，落成 DB 部分唯一索引（I-P44）
 *
 * ## ⚠ 本文件刻意**没有**的东西（缺了是结论，不是遗漏）
 *   · 准备度百分比 —— 概览只放 Q-6② 白名单四件；口径见 O-32 ④，
 *     但「项目筹备侧的已定义项表是哪张」无出处（U-6 第二格空白）→ `KNOWN_CONTRACT_GAPS.P6`
 *   · 父子项目 / 删除项目 / 归档可逆之外的第三态 —— 裁决判负，不留码
 *   · 非工作坊两类的成员操作 —— U-1 已裁数据形状，**但 usecases.md 没有对应操作**
 *     → `KNOWN_CONTRACT_GAPS.P2`。裁决定的是形状，开操作要重新签核
 *
 * ⚠ **一个不会被任何路径抛出的错误码读起来像覆盖，而它什么都没覆盖**
 *   （`apps/api/migrations/0008-f06-binding-modes.sql:29-31` 逐字）。
 *   本文件的 `ProjectReason` 每一个成员都在下方某个操作的 `err` 里出现。
 */
import { z } from "zod";
import { PermissionReason } from "./identity";
import { ArtifactError, ArtifactSource, BackflowEntry } from "./artifact";
import { TemplateError } from "./templates";

/* ─────────────────────── 枚举（与 domain.md 一一对应）─────────────────────── */

/**
 * 三类容器。**闭集，且三类的过程与目的完全不同**（人类 Q-12 裁决 C 逐字：
 * 「研究项目和项目是完全不同的两种项目……还有一个是用户洞察，也是一种独立的项目」）。
 *
 * ⚠ `kind` 在 `projects` 上是**判别列**（U-9 裁 A），不是行为分支：
 *   它只回答「这行的子类型表在哪」，三类的行为全在各自子表里。
 *   与被否决的 Q-12 候选 A（`kind ∈ {research, delivery}` 一张表两条代码路径）形似而不同——
 *   半年后想删它的人请先读 `domain.md` §一之三第 2 小节。
 *
 * ⚠ 成员逐个等于 DB CHECK（`projects.kind`）与三张子表的 `kind` 常量 CHECK。
 */
export const ProjectKind = z.enum(["workshop", "research_project", "user_insight"]);

/**
 * 生命周期。**恰好两态**（Q-5 裁 B）：`archived` = 只读，**归档不删除任何内容**。
 *
 * ⚠ 刻意**没有** `deleted` / `purged`：Q-9 裁「不提供删除项目」。
 * ⚠ 刻意**没有**「因容器归档而终止」这一档投影到环节上——U-2⑵ 裁「拒绝归档」，
 *   即有 `active` 环节时归档直接失败，四态集合不动。
 */
export const ProjectStatus = z.enum(["active", "archived"]);

/**
 * 议程环节四态（Q-2② 裁 B）。`closed` 与 `skipped` **均可带 `mergedInto`**。
 *
 * ⚠ **不得**退化成 `startedAt` / `endedAt` 时间戳：临时提权的失效条件是
 *   **流程节点不是时间点**（`uc-1-4:98` 逐字），时间戳表达不了「被跳过」与「被合并」。
 */
export const AgendaSegmentState = z.enum(["pending", "active", "closed", "skipped"]);

/**
 * 推进动作的四种去向（UC-P7 标题逐字：推进 / 跳过 / 提前结束 / 合并）。
 *
 * ⚠ 这不是权限动作词。权限侧的闭集动作词是 `agendaSegment.advance`
 *   （F121 改名对齐后的现名，旧的 `stage.` 前缀写法已判负），
 *   **在 `apps/api/src/domain/identity/project-role-matrix.ts` 里，本束引用不得抄**（I-P12）。
 */
export const AgendaSegmentAdvanceAction = z.enum(["advance", "closeEarly", "skip", "merge"]);

/**
 * 非工作坊两类容器的成员档位（**U-1 裁 B**，2026-07-30 16:34:55+08:00）。
 *
 * ⚠ 两档**不复用**工作坊四角色——那正是人类收窄裁决要挡住的事
 * （逐字：「在访谈里是没有这几种角色的，引导师、组长什么的是不必要的」）。
 * ⚠ 「拥有者 / 协作者」这两个词**原型里没有逐字出现**，是 U-1 候选 B 对
 *   「负责人 + 其余可进来的人」的最小命名，人类已勾选采纳。
 * ⚠ 本枚举现在**没有任何操作使用它**——见 `KNOWN_CONTRACT_GAPS.P2`。
 *   留在这里是因为 `itv-v2` 已经在 `apps/web/lib/mock/itv.ts:26` 自造了三档视角并自注
 *   「待迁入 packages/contracts」；不落单源，它就是本仓第十次「同一事实两处声明」。
 */
export const NonWorkshopMemberRole = z.enum(["owner", "collaborator"]);

/**
 * 本束的失败面。**每一个成员都在下方某个操作的 `err` 里出现**（见文件头注）。
 *
 * 分三段：
 *   ① 与 phase-00 `identity` 束**同码同义**（下方 `_sharedWithIdentity` 是它的编译期门控）
 *   ② 与 phase-00 `artifact` 束**同码同义**（`_sharedWithArtifact` 同理）
 *   ③ 本束新增（`usecases.md` §3.2 逐条列出，**这里不许多一条**）
 */
export const ProjectReason = z.enum([
  /* ── ① identity 束同码同义 ────────────────────────────────────── */
  /** ⚠ **正常状态不是异常**（I-P9）。且与「无项目上下文」（`projectLayer === null`）**禁止合并** */
  "NO_PROJECT_ROLE",
  /** 有角色但该角色不含此动作。例：`groupLead` 调推进环节 */
  "PROJECT_ROLE_INSUFFICIENT",
  /** D-18：管理员不是超级用户。⚠ `purpose:"audit"` 是**放行 + 留痕**不是 403（O-04 反转过一次） */
  "ADMIN_NOT_SUPERUSER",
  /** ⚠ 判定服务不可用**一律拒绝，不得降级放行** */
  "AUTH_SERVICE_UNAVAILABLE",

  /* ── ② artifact 束同码同义 ───────────────────────────────────── */
  /** 存储/检索依赖不可用。⚠ **不得**把失败呈现为空列表——空与失败必须可区分（uc-00-2 E3 / V9） */
  "DEPENDENCY_UNAVAILABLE",

  /* ── ③ 本束新增（usecases.md §3.2）────────────────────────────── */
  /**
   * 组织角色不足以创建 / 管理项目（U-4 裁 A：只有 `lead` 能创建，`admin` 不能）。
   *
   * ⚠ **`usecases.md:54` 写着「与 phase-00 同码同义」，那句话不成立**：
   *   全仓（`identity.ts` / `auth.ts` / `0003-identity.sql`）没有这个字面量，
   *   `PermissionReason` 里最接近的是 `ORG_SCOPE_DENIED`（可见性范围），语义不同。
   *   ⇒ **本文件是它的第一处声明**，不是引用。见 `KNOWN_CONTRACT_GAPS.P1`。
   */
  "ORG_ROLE_INSUFFICIENT",
  /** `kind` 不在三值闭集内。⚠ DB CHECK 与本枚举**成员逐个相等**，不是包含 */
  "INVALID_KIND",
  /**
   * 违反「同一工作坊至多一个 `active`」（I-P44）。
   * ⚠ 它由**部分唯一索引**产生，**不是**应用层先查后写——先查后写在并发下就是那条空转的门。
   */
  "SEGMENT_ALREADY_ACTIVE",
  /** 对 `closed` / `skipped` 再次推进。⚠ 终态有**两个**，只测 `closed` 会漏 `skipped` */
  "SEGMENT_TERMINAL",
  /**
   * 对 `archived` 容器写入（Q-5 B）。
   * ⚠ 冻结做在 **PG RESTRICTIVE 策略**里（照 F22 组织冻结的形状），
   *   应用层这个码是**它的投影**，不是第二处判定。
   */
  "PROJECT_ARCHIVED",

  /* ── ④ templates 束同码同义（design-deltas/createproject-blueprint-error-codes/，
   *     人类签核 2026-08-16，BP-08 前置）──────────────────────────────────── */
  /**
   * `createProject` 传入的 `blueprintVersionId` 解析不到蓝本，**或**该蓝本对调用者
   * 越权可见——两者不可区分，不泄露资源存在性（与 `templates` 束同一条纪律，
   * `_sharedWithTemplates` 编译期钉住与 `TemplateError` 同一字面量）。
   */
  "BLUEPRINT_NOT_FOUND",
  /** 解析到蓝本，但 team-only 且调用者不在该 team。 */
  "BLUEPRINT_NOT_VISIBLE",
  /** 蓝本存在但从未发布过任何版本（`resolvedVersion === null`）。 */
  "BLUEPRINT_NOT_PUBLISHED",
  /**
   * 传入的版本已被归档，且这是一次**新增绑定**（I-7：存量绑定的实例化不受此拒，
   * 本码只挡"拿一个归档版本去建新项目"）。
   */
  "BLUEPRINT_VERSION_ARCHIVED",
  /**
   * 六类写入部分失败（已整体回滚）。detail 须指明失败的类别名（同 `templates.applyBlueprint`
   * 既有纪律）。⚠ 今天只有"议程环节"一类有真实存储可写（F118），其余五类
   * （分组/角色分工/材料清单/会前任务/画布与产出物）尚无落地表（F24-F29 未实现，
   * `KNOWN_CONTRACT_GAPS`/`project-prep-ports.ts` 已记），本码在 BP-08 范围内
   * 实际只可能因议程环节写入失败而触发，不是本码语义变窄，是当前系统状态如此。
   */
  "INITIALIZATION_FAILED",
  /**
   * 2026-08-16（F185，delta）：`updateProjectTags` 指向一个不存在（或不在当前组织下）的容器 id。
   */
  "PROJECT_NOT_FOUND",
]);

type ProjectReasonT = z.infer<typeof ProjectReason>;
type PermissionReasonT = z.infer<typeof PermissionReason>;
type ArtifactErrorT = z.infer<typeof ArtifactError>;
type TemplateErrorT = z.infer<typeof TemplateError>;

/**
 * **跨束同码同义的编译期门控**（`pnpm --filter @repo/contracts run typecheck` 会红）。
 *
 * 交集类型 `PermissionReasonT & ProjectReasonT` 只接受**两个枚举都有**的字面量：
 * 任何一侧改名、拼错、或有人在本束「另起一份名字」，这里立刻不通过类型检查。
 *
 * ⚠ 为什么不 import 枚举本身：`identity` 是更内层的束，
 *   直接 import 会让本束的失败面随它变动。这里要的是「同名是刻意的」的**证明**，
 *   不是依赖（同 `auth.ts` 对 `NO_ORG_MEMBERSHIP` 的处理）。
 */
const _sharedWithIdentity = [
  "NO_PROJECT_ROLE",
  "PROJECT_ROLE_INSUFFICIENT",
  "ADMIN_NOT_SUPERUSER",
  "AUTH_SERVICE_UNAVAILABLE",
] as const satisfies readonly (PermissionReasonT & ProjectReasonT)[];

const _sharedWithArtifact = ["DEPENDENCY_UNAVAILABLE"] as const satisfies readonly (ArtifactErrorT &
  ProjectReasonT)[];

/**
 * **design-deltas/createproject-blueprint-error-codes/ 签核的五个码，与 `templates` 束
 * 同码同义**（人类签核 2026-08-16，BP-08 前置）。`createProject` 首次需要表达
 * "传入的 blueprintVersionId 不合法"，而这五种"不合法"的语义已经在 `templates` 束
 * 钉死——这里不重新定义，只证明字面量与 `TemplateError` 完全对得上。
 */
const _sharedWithTemplates = [
  "BLUEPRINT_NOT_FOUND",
  "BLUEPRINT_NOT_VISIBLE",
  "BLUEPRINT_NOT_PUBLISHED",
  "BLUEPRINT_VERSION_ARCHIVED",
  "INITIALIZATION_FAILED",
] as const satisfies readonly (TemplateErrorT & ProjectReasonT)[];

/**
 * **两个由本束「变为可评估」、但抛出者不在本束的失败码。**
 *
 * `STEP_CLOSED` / `STEP_REJECTS_ARTIFACT_TYPE` 是 `artifact.bindToProjectStep` 的 `err`
 * （phase-00 已签核）。它们此前不可评估，因为绑定关系的环节字段无外键、环节无实体、
 * `acceptedSources` 无出处——**本束建 `agenda_segments` 表 + 补外键 + 落白名单之后，
 * 这两条门第一次能红**（Q-2① A + Q-2③ + Q-8）。
 *
 * ⚠ **本束不给它们再声明一遍**：那会造出第二份同名码。
 *   这里只用 `satisfies` 钉住「本束依赖的就是 artifact 束那两个字面量」——
 *   `artifact` 侧改名，这里编译失败。
 *
 * ⚠ 两个码的**名字**是否随 F121 改名对齐一起改成 `SEGMENT_*`：**本束不改**
 *   （改错误码字面量属修订已签核束，F121 的裁决文本只提到字段名与动作词）。
 *   已登记为 `MIGRATION-IMPACT.md` 第二节的待确认边界。
 */
export const STEP_GATE_CODES = [
  "STEP_CLOSED",
  "STEP_REJECTS_ARTIFACT_TYPE",
] as const satisfies readonly ArtifactErrorT[];

/* ─────────────────────────────── 实体 ─────────────────────────────── */

/**
 * 容器超类型。**列集合是一个封闭清单**（I-P33 🔴）：
 * 恰好 `{ id, orgId, name, status, kind }`，三类共用的只有「容器身份 + 组织归属 + 状态」。
 *
 * ⚠ **任何把工作坊专属字段（议程环节、分组、蓝本引用、会前/现场/会后……）
 *   加进这里的改动都违反 Q-12 裁决。** 它有一道白名单等值门控（不是黑名单）——
 *   黑名单挡不住下一个没被想到的名字：`agenda_segment_id` 被挡住了，`current_segment_id` 没有。
 */
export const Project = z
  .object({
    id: z.string(),
    /** ⚠ 单列非空外键 ⇒ **项目跨组织不可表达**（I-P1，已落库，不是待定项） */
    orgId: z.string(),
    name: z.string(),
    status: ProjectStatus,
    kind: ProjectKind,
  })
  .strict();

/**
 * 列表项。⚠ **出现在 `managed` 段里 ≠ 能进去看内容**（D-18 边界）——
 * 因此这里**不得**附带任何内容摘要、任何计数、任何「最近活动」。
 *
 * ⚠ 刻意**没有**「准备度 %」：口径见 `KNOWN_CONTRACT_GAPS.P6`。
 *   在别处编一个分母就是第二份事实（本仓已因此出过事故：`design-coherence.md:200`）。
 */
export const ProjectListItem = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: ProjectKind,
    status: ProjectStatus,
    /**
     * 只读原因。null = 可写。
     * ⚠ 两种只读**必须可分辨**：容器自己归档了（`archived`），与它所属组织被停用了
     * （`org-disabled`，来自组织层 PG RESTRICTIVE 策略）。
     * 两处都是「显示且标注只读，**不消失**」（Q-5 B ↔ Q-7③ 耦合，两处呈现必须一致）——
     * 藏起来读作「产品做不到这件事」，而真相是「这个组织不允许」。
     */
    readOnlyReason: z.enum(["archived", "org-disabled"]).nullable(),
    /**
     * 2026-08-16（F185，delta）：项目自由文本标签，默认 `[]`。由 `updateProjectTags`
     * 整体替换写入（不是增量 patch）。不是内容摘要，不触碰 D-18 边界。
     */
    tags: z.array(z.string()),
  })
  .strict();

/** `updateProjectTags` 单条 tag 的校验规则——与迁移里的 CHECK 校验函数逐字对应，不在两处各判一次不同的口径。 */
export const ProjectTag = z.string().trim().min(1).max(40);
export const PROJECT_TAGS_MAX = 20;

/**
 * 议程环节实例（Q-2① 裁 A：**建独立表** `agenda_segments`，挂 `workshops`）。
 *
 * ⚠ 字段名单源：`agendaSegment` / `agendaSegmentId`（D-03a，全局权威）。
 *   三个败选名（旧驼峰/蛇形环节字段名、`stage.` 前缀动作词、下划线阶段名）
 *   由 Q-3 ① 一并判负；phase-00 已落库的旧名**已改名对齐**（F121，签核动作，见 MIGRATION-IMPACT.md）。
 *   全仓不得再出现这三个败选名——由 `tests/project/naming-single-source-gate.test.ts` 门控。
 */
export const AgendaSegment = z
  .object({
    id: z.string(),
    /** ⚠ 挂 `workshops` 不是 `projects`——议程环节是**工作坊机件**（人类 2026-07-30 逐字）。
     *  在超类型模型下 `workshops.id ≡ projects.id`，故容器 id 与此值相等，两句不冲突。 */
    workshopId: z.string(),
    /**
     * 指回**蓝本侧**的环节定义（O-02 裁 ②：套用时**引用而非内联**，蓝本 ⊃ 工作流模板两层）。
     * null = 未套蓝本时手工搭出来的环节。
     */
    agendaSegmentDefinitionId: z.string().nullable(),
    ordinal: z.number().int().nonnegative(),
    title: z.string(),
    /** ⚠ **单位无出处**（原型只给「时长档位」）→ `KNOWN_CONTRACT_GAPS.P5`。不在这里替人定 */
    duration: z.number().int().positive(),
    state: AgendaSegmentState,
    /** 并入的目标环节。⚠ **只在 `closed` / `skipped` 上可非空**（Q-2② B），由 DB CHECK 保证 */
    mergedInto: z.string().nullable(),
    /**
     * 本环节接受哪些来源的产出（Q-2③）。**空数组 = 不限制（默认全接受）**。
     *
     * ⚠ **默认全接受 = 这道门默认不生效。** 交付时**必须**同时有
     *   「至少一个环节配置了非空白名单」的反证测试，否则 `STEP_REJECTS_ARTIFACT_TYPE`
     *   等于没上线——这正是 I-P45 与 V5 第三条要求的。
     */
    acceptedSources: z.array(ArtifactSource),
  })
  .strict();

/** 概览里的四类项目角色人数。⚠ **仅 `kind='workshop'`**；另两类此字段为 null */
export const WorkshopRoleCounts = z
  .object({
    facilitator: z.number().int().nonnegative(),
    groupLead: z.number().int().nonnegative(),
    member: z.number().int().nonnegative(),
    observer: z.number().int().nonnegative(),
  })
  .strict();

/**
 * **禁止存在的路由**（UC-P5 / I-P40 / U-3①）。
 *
 * 交付物是**一条断言它不存在的测试**，不是一个接口——理由逐字照抄 N-5：
 * 「**『没有』这件事本身没人会去验**，某天有人为别的需求加上，不会有任何东西报警。」
 *
 * ⚠ 数据库层已有一个 BEFORE DELETE 触发器在替我们挡（`0008-f06:191`），
 *   **但那是防御不是规范**，规范要写在路由表的断言里
 *   （`packages/contracts/tests/no-forbidden-routes.test.ts`）。
 */
export const PROJECT_FORBIDDEN_ROUTES = [
  {
    route: "DELETE /projects/:projectId",
    why: "Q-9 裁「不提供删除项目」。级联事实不变：groups / project_memberships / artifact_bindings 是 ON DELETE CASCADE——加上删除，级联会静默清掉一批行（I-P29）。",
  },
] as const;

/**
 * **Studio 产出进项目的路径唯一**（U-3① 裁 A）。
 *
 * 唯一挂载点是 phase-00 的 `artifact.bindToProjectStep`（F06 已 passing）。
 * ⚠ 本束**不新增第二条挂载路由**：第二条必然绕开 I-14（只有 `pinned` 可被下游引用）
 *   与三模式绑定中的某一条，而 I-14 的验证面会从 1 处变 N 处。
 */
export const SOLE_MOUNT_OPERATION = "artifact.bindToProjectStep" as const;

/* ───────────────────────────── 操作 ───────────────────────────── */

export const operations = {
  /**
   * UC-P1 `createProject` —— **一条创建路径 + 蓝本可选参数**（Q-1 裁 C）
   *
   * ## 事务
   * **一处创建事务**，必须原子地写**两行**：`projects` 一行 + 对应子类型表一行。
   * ⚠ 两行分两次提交 = 出现「有容器没子类型」的中间态，那正是 I-P34 想排除的东西。
   *
   * ## 刻意不做的事
   * **不自动给创建者授予项目角色。** 依据是 Q-4② 的裁决（`lead` 对自建未加入的项目
   * **持管理权、不持内容读取权**）——若创建即授角色，那条边的两端就不存在了，
   * 「管理员不是超级用户」随之破掉。
   *
   * ## 谁能建
   * 只有组织角色 `lead`（其职责逐字「创建与管理项目」）。
   * **U-4 已裁 A：`admin` 不能创建**——与 `uc-0-3` R5 的能力枚举一致，
   * 且与 D-18 同向：管理员的权是**治理**不是**参与**。
   */
  createProject: {
    method: "POST",
    path: "/projects",
    in: z
      .object({
        orgId: z.string(),
        name: z.string().min(1),
        kind: ProjectKind,
        /**
         * **空白新建 = 传 `null`**（Q-1 C 逐字），此时**六类初始化跳过而非写空值**——
         * 不造「空白蓝本」这种语义空壳。
         * ⚠ 非 workshop 的 `kind` 能否接受本参数：蓝本是工作坊机件，
         *   U-1 定了两类各有自己的成员表但**没说筹备机件** → `KNOWN_CONTRACT_GAPS.P4`。
         */
        blueprintVersionId: z.string().nullable(),
      })
      .strict(),
    out: z
      .object({
        /** ⚠ 容器 id **就是**子类型行的 id（超类型模型下 1:1） */
        id: z.string(),
        kind: ProjectKind,
        status: ProjectStatus,
        /** ⚠ 见 `KNOWN_CONTRACT_GAPS.P3`：`ProvenanceEventType` 里没有「项目已创建」这个类型 */
        provenanceEventId: z.string(),
      })
      .strict(),
    /**
     * ⚠ 2026-08-16 起不再是"刻意没有蓝本码"——BP-08（createProject 真执行六类初始化）
     *   把 `blueprintVersionId` 从"原样落库"换成"真的用它初始化"之后，"蓝本不合法该
     *   怎么报错"第一次变成必须存在的分支。五个新码走了独立契约签核
     *   （`design-deltas/createproject-blueprint-error-codes/`，人类 2026-08-16 确认），
     *   与 `templates.TemplateError` 同码同义（`_sharedWithTemplates` 编译期钉住）。
     * ⚠ 组织 `disabled` 不在这里：那是 **PG RESTRICTIVE 策略**拒写，断言在数据库层（I-P28）。
     */
    err: [
      "ORG_ROLE_INSUFFICIENT",
      "INVALID_KIND",
      "AUTH_SERVICE_UNAVAILABLE",
      "BLUEPRINT_NOT_FOUND",
      "BLUEPRINT_NOT_VISIBLE",
      "BLUEPRINT_NOT_PUBLISHED",
      "BLUEPRINT_VERSION_ARCHIVED",
      "INITIALIZATION_FAILED",
    ] as const,
  },

  /**
   * UC-P2 `listProjects` —— **扁平数组**（Q-6① 2026-08-16 delta 裁 D，覆盖 2026-07-30 裁 B）
   *
   * ⚠ 2026-08-16 之前这里是 `{ member: [], managed: [] }` 两段式——那条裁决已被人类在
   *   会话里直接推翻（见 `requirements/00-project/OPEN-QUESTIONS.md` 「🔁 2026-08-16 delta」）。
   *   「我在这个项目里」/「我管着这个项目」两种入列理由依然存在，只是不再体现为响应体的
   *   顶层分段——同一容器满足任一理由都会出现，按 `id` **去重**，只出现一次。
   *
   * ⚠ **平铺，不折叠**（Q-12 必裁三件之 3 逐字，未受本次 delta 影响）。
   * ⚠ 按 `kind`/`tags` 分区或筛选是**展示决定不是响应体决定**。
   * ⚠ `[]` 是**正常空态**，且**不生成伪数据**。
   */
  listProjects: {
    method: "GET",
    path: "/projects",
    in: z.object({ orgId: z.string() }).strict(),
    out: z.array(ProjectListItem),
    err: ["AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * `updateProjectTags` —— 2026-08-16（F185，delta）新增。
   *
   * 整体替换项目的 `tags`（不是增量 patch），与 F180
   * `updatePersonalTranscriptionMetadata` 的 `tags` 语义同型，不另发明一套局部
   * add/remove 接口。权限复用 `archiveProject` 同一条线（组织角色 `lead`/`admin`）。
   */
  updateProjectTags: {
    method: "PATCH",
    path: "/projects/:projectId/tags",
    in: z
      .object({
        projectId: z.string(),
        tags: z.array(ProjectTag).max(PROJECT_TAGS_MAX),
      })
      .strict(),
    out: z.object({ id: z.string(), tags: z.array(z.string()) }).strict(),
    err: ["ORG_ROLE_INSUFFICIENT", "AUTH_SERVICE_UNAVAILABLE", "PROJECT_NOT_FOUND"] as const,
  },

  /**
   * UC-P3 `getProjectOverview` —— 概览**只放已有出处的东西**（Q-6② 白名单四件）
   *
   * ⚠ **白名单是封闭的**：当前议程环节 · 四类项目角色人数 · 回流列表 · 蓝本名与版本。
   *   加第五件属修订已签核裁决，不是「补一个板块」。
   * ⚠ **不展示尚未绑定的产出**（U-3② 确认 Q-6② 白名单即答案）：
   *   未绑定就是未归属，展示它等于制造一份没有绑定行支撑的第二份项目内容清单。
   * ⚠ **准备度百分比不在本域定义，界面亦不显示**（见 `KNOWN_CONTRACT_GAPS.P6`）。
   */
  getProjectOverview: {
    method: "GET",
    path: "/projects/:projectId/overview",
    in: z.object({ projectId: z.string() }).strict(),
    out: z
      .object({
        projectId: z.string(),
        name: z.string(),
        kind: ProjectKind,
        status: ProjectStatus,
        /** ⚠ 仅工作坊；另两类为 null。**null 与「有工作坊但还没有环节」不同**，后者是 `state:'pending'` 的第一条 */
        currentAgendaSegment: AgendaSegment.nullable(),
        /** ⚠ 仅工作坊；另两类为 null（四种项目角色不适用，人类 2026-07-30 收窄裁决） */
        roleCounts: WorkshopRoleCounts.nullable(),
        /**
         * 回流列表。**路由 / 字段 / 徽标 / 空态 / 失败码已由 phase-00 定死，不可再发明**（I-P24）：
         * 四字段非空、`badge` 三值闭枚举、**草稿不在此列表**、空态返回 `[]` 且不生成伪数据。
         * ⚠ 这里**引用** `artifact.BackflowEntry`，不抄一份。
         */
        backflow: z.array(BackflowEntry),
        /** 蓝本名与版本。null = 空白新建（Q-1 C：跳过六类初始化，不写空值） */
        blueprint: z.object({ name: z.string(), version: z.number().int().positive() }).strict().nullable(),
      })
      .strict(),
    /**
     * ⚠ `DEPENDENCY_UNAVAILABLE` 与「空列表」**必须可区分**（uc-00-2 V9）：
     *   把失败呈现成空列表，用户会以为「这里本来就没有东西」。
     */
    err: [
      "NO_PROJECT_ROLE",
      "ADMIN_NOT_SUPERUSER",
      "DEPENDENCY_UNAVAILABLE",
      "AUTH_SERVICE_UNAVAILABLE",
    ] as const,
  },

  /**
   * UC-P4 `archiveProject` —— 两态之一（Q-5 裁 B）
   *
   * ⚠ **归档不删除任何东西**：这本身就是 X-4 豁口的正确一侧——
   *   豁口只留给**合规撤回**，不该被「项目结束」这种日常动作借道
   *   （且 X-4 依赖的 O-39 法定留存清单**不存在**，取值抛错而非放行）。
   * ⚠ 冻结做在 **PG RESTRICTIVE 策略**里（照 F22 组织冻结的已 passing 形状），
   *   不是应用层 `if`。
   * ⚠ 归档后**读仍可用** —— 只断言「拒写」时，一个「归档即 404」的实现也会全绿（I-P38）。
   *
   * ## U-2⑵ 已裁「拒绝归档」，但**它的失败码没有名字**
   * 有 `active` 议程环节时必须报错。裁决文本逐字写着「需要一个新码（本文**不命名**，等裁决）」，
   * 而 `usecases.md` §3.2 的新增码清单里也没有它。
   * ⇒ **本文件不发明它**，登记为 `KNOWN_CONTRACT_GAPS.P7`。
   */
  archiveProject: {
    method: "POST",
    path: "/projects/:projectId/archive",
    in: z.object({ projectId: z.string() }).strict(),
    out: z
      .object({
        projectId: z.string(),
        status: ProjectStatus,
        provenanceEventId: z.string(),
      })
      .strict(),
    err: ["ORG_ROLE_INSUFFICIENT", "PROJECT_ARCHIVED", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * UC-P4 `unarchiveProject` —— **归档可逆**（U-2⑴ 裁 a）
   *
   * 与原型同向（运行态里「已归档」是可增删的标签，且同屏有同型正例
   * 「线程已归档，恢复为活跃后才能继续发言」）；归档只是收纳，误归档能救回来。
   * ⚠ **不照抄 F22 组织冻结的不可逆形状**：组织冻结不可逆的代价由组织承担（罕见操作），
   *   项目归档是**日常动作**，不可逆代价大得多。
   * ⚠ 解归档权限**同归档者**，不新造角色（U-2⑴ 裁决行逐字）。
   */
  unarchiveProject: {
    method: "POST",
    path: "/projects/:projectId/unarchive",
    in: z.object({ projectId: z.string() }).strict(),
    out: z
      .object({
        projectId: z.string(),
        status: ProjectStatus,
        provenanceEventId: z.string(),
      })
      .strict(),
    err: ["ORG_ROLE_INSUFFICIENT", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /* UC-P5 `deleteProject` —— **不提供**（Q-9）。见 `PROJECT_FORBIDDEN_ROUTES`。 */

  /**
   * UC-P6 `createAgendaSegment` —— 环节实例落到独立表（Q-2① 裁 A）
   *
   * ⚠ 套蓝本时是**引用而非内联**（O-02 ②）：项目侧实例持 `agendaSegmentDefinitionId`
   *   指回蓝本侧定义，**不复制定义内容**——复制即第二份事实源。
   */
  createAgendaSegment: {
    method: "POST",
    path: "/workshops/:workshopId/agenda-segments",
    in: z
      .object({
        workshopId: z.string(),
        agendaSegmentDefinitionId: z.string().nullable(),
        ordinal: z.number().int().nonnegative(),
        title: z.string().min(1),
        duration: z.number().int().positive(),
      })
      .strict(),
    out: AgendaSegment,
    err: [
      "NO_PROJECT_ROLE",
      "PROJECT_ROLE_INSUFFICIENT",
      "PROJECT_ARCHIVED",
      "AUTH_SERVICE_UNAVAILABLE",
    ] as const,
  },

  /**
   * UC-P6 `listAgendaSegments`
   *
   * ⚠ 议程环节状态是**三视角首屏的唯一驱动源**，不得各视角各自判断当前环节。
   *   「唯一驱动源」这句话只有配上 DB 部分唯一索引（I-P44）才是可断言的。
   */
  listAgendaSegments: {
    method: "GET",
    path: "/workshops/:workshopId/agenda-segments",
    in: z.object({ workshopId: z.string() }).strict(),
    out: z.array(AgendaSegment),
    err: ["NO_PROJECT_ROLE", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },

  /**
   * UC-P7 `advanceAgendaSegment` —— 推进 / 提前结束 / 跳过 / 合并
   *
   * ## 副作用是契约的一部分（已签核，必须实现）
   * 状态机变更时**服务端主动收回**按环节授予的临时读权。
   * 失效条件是**流程节点不是时间点**；**提前结束 / 跳过 / 合并**三种非正常结束
   * **同样立即失效**，且不得靠前端或定时轮询兜底。
   *
   * ⚠ `revokedTemporaryGrants` 把这条副作用变成**响应里可断言的东西**。
   *   没有它，V8 的四向断言只能去查库；而一个「从不授权」的实现在只有单向断言时四条全绿——
   *   所以反向断言（环节仍进行时该权限**有效**）同样必须写。
   */
  advanceAgendaSegment: {
    method: "POST",
    path: "/workshops/:workshopId/agenda-segments/:segmentId/advance",
    in: z
      .object({
        workshopId: z.string(),
        segmentId: z.string(),
        action: AgendaSegmentAdvanceAction,
        /** ⚠ 仅 `action: "merge"` 时非空；`closed` 与 `skipped` 均可带 `mergedInto`（Q-2② B） */
        mergeIntoSegmentId: z.string().nullable(),
      })
      .strict(),
    out: z
      .object({
        segment: AgendaSegment,
        /** 本次状态机变更中被服务端主动收回的临时提权条数（可为 0） */
        revokedTemporaryGrants: z.number().int().nonnegative(),
        provenanceEventId: z.string(),
      })
      .strict(),
    err: [
      "NO_PROJECT_ROLE",
      "PROJECT_ROLE_INSUFFICIENT",
      "SEGMENT_ALREADY_ACTIVE",
      "SEGMENT_TERMINAL",
      "PROJECT_ARCHIVED",
      "AUTH_SERVICE_UNAVAILABLE",
    ] as const,
  },

  /**
   * UC-P8 `setAcceptedSources` —— 环节接受哪些产出来源（Q-2③）
   *
   * ⚠ **默认全接受**（空数组 = 不限制），由蓝本的「材料要求」投影而来。
   * ⚠ **默认全接受 = 这道门默认不生效** ⇒ 交付时**必须**同时有
   *   「至少有一个环节配置了非空白名单」的反证测试，否则又是一条空转的门。
   * ⚠ 原型的环节卡**没有任何白名单控件**（`ui.md` B-4），界面形状属签核第 ① 件待补。
   *
   * ⚠ 抛 `STEP_REJECTS_ARTIFACT_TYPE` 的是 `artifact.bindToProjectStep`，**不是本操作**——
   *   本操作只是让那道门第一次有判据。见 `STEP_GATE_CODES`。
   */
  setAcceptedSources: {
    method: "POST",
    path: "/workshops/:workshopId/agenda-segments/:segmentId/accepted-sources",
    in: z
      .object({
        workshopId: z.string(),
        segmentId: z.string(),
        /** ⚠ 七类来源枚举**引用** `artifact.ArtifactSource`，不抄一份 */
        acceptedSources: z.array(ArtifactSource),
      })
      .strict(),
    out: AgendaSegment,
    err: [
      "NO_PROJECT_ROLE",
      "PROJECT_ROLE_INSUFFICIENT",
      "SEGMENT_TERMINAL",
      "PROJECT_ARCHIVED",
      "AUTH_SERVICE_UNAVAILABLE",
    ] as const,
  },

  /**
   * UC-P9 `addProjectMember` —— **两个入口共用同一个 application 用例**（Q-4① 裁 B）
   *
   * 组织内成员**直接指派**（`subject.kind: "orgUser"`）与组织外/免注册走**邀请链接**
   * （`subject.kind: "inviteToken"`，链接本体在 `01-auth`）——
   * **差别只在身份来源**，判定与落库是同一条路径。
   *
   * ⚠ 理由同「`readContent` 为什么不给个人层另开接口」：
   *   另开一个接口意味着不变量要写两遍，**漏掉的那一遍不会有任何东西报警**。
   *
   * ⚠ **仅 `kind='workshop'`**。另两类各有一张成员表（U-1 裁 B），
   *   但 `usecases.md` 没有对应操作 → `KNOWN_CONTRACT_GAPS.P2`。
   * ⚠ 展示别名**不落库**：「协同引导师」入库值是 `facilitator`（多实例，其中一名带 `isHost`）；
   *   研究员 / 参与者不落库；受访者**不持项目角色**（走一次性令牌）。
   */
  addProjectMember: {
    method: "POST",
    path: "/projects/:projectId/members",
    in: z
      .object({
        projectId: z.string(),
        subject: z
          .object({
            kind: z.enum(["orgUser", "inviteToken"]),
            /** `orgUser` 时是 userId；`inviteToken` 时是令牌。**两者不得合并成一个裸字符串字段** */
            ref: z.string(),
          })
          .strict(),
        /** ⚠ 四取值闭集，**引用 phase-00 的 `identity.ProjectRole` 语义**，本束不改写 */
        projectRole: z.enum(["facilitator", "groupLead", "member", "observer"]),
        /** ⚠ 仅 `facilitator` 可为 true；「至少一名 `isHost`」**没有出处**，本束不设定（uc-00-3 E6） */
        isHost: z.boolean(),
      })
      .strict(),
    out: z
      .object({
        projectId: z.string(),
        userId: z.string(),
        projectRole: z.enum(["facilitator", "groupLead", "member", "observer"]),
        isHost: z.boolean(),
        provenanceEventId: z.string(),
      })
      .strict(),
    err: [
      "NO_PROJECT_ROLE",
      "PROJECT_ROLE_INSUFFICIENT",
      "ORG_ROLE_INSUFFICIENT",
      "PROJECT_ARCHIVED",
      "AUTH_SERVICE_UNAVAILABLE",
    ] as const,
  },

  /**
   * UC-P9 `changeProjectRole`
   *
   * ⚠ **生效时机是契约的一部分**（Q-4③ 裁）：**不缓存跨请求的判定结论**，
   *   只缓存单请求内的（`authorizeBatch` 存在的意义正是让这条可承受）。
   *   ⇒ 角色变更**下一次请求即生效**，不等会话过期、不等缓存 TTL。
   * ⚠ 一人一项目**恰好一个**角色（主键 `(userId, projectId)`），所以这里是「改」不是「加」。
   */
  changeProjectRole: {
    method: "PATCH",
    path: "/projects/:projectId/members/:userId",
    in: z
      .object({
        projectId: z.string(),
        userId: z.string(),
        projectRole: z.enum(["facilitator", "groupLead", "member", "observer"]),
        isHost: z.boolean(),
      })
      .strict(),
    out: z
      .object({
        projectId: z.string(),
        userId: z.string(),
        projectRole: z.enum(["facilitator", "groupLead", "member", "observer"]),
        isHost: z.boolean(),
        provenanceEventId: z.string(),
      })
      .strict(),
    err: [
      "NO_PROJECT_ROLE",
      "PROJECT_ROLE_INSUFFICIENT",
      "ORG_ROLE_INSUFFICIENT",
      "PROJECT_ARCHIVED",
      "AUTH_SERVICE_UNAVAILABLE",
    ] as const,
  },

  /**
   * UC-P9 `removeProjectMember`
   *
   * ⚠ 移除的是**成员关系**，不是任何内容——与 Q-9「不提供删除项目」不冲突。
   * ⚠ 「移除最后一名引导师 / 最后一名 `isHost`」**未裁**（uc-00-3 E6，
   *   `isHost` 在库里是无约束布尔）→ 本操作**不为它设失败码**。
   */
  removeProjectMember: {
    method: "DELETE",
    path: "/projects/:projectId/members/:userId",
    in: z.object({ projectId: z.string(), userId: z.string() }).strict(),
    out: z
      .object({
        projectId: z.string(),
        userId: z.string(),
        provenanceEventId: z.string(),
      })
      .strict(),
    err: [
      "NO_PROJECT_ROLE",
      "PROJECT_ROLE_INSUFFICIENT",
      "ORG_ROLE_INSUFFICIENT",
      "PROJECT_ARCHIVED",
      "AUTH_SERVICE_UNAVAILABLE",
    ] as const,
  },

  /* UC-P10 无项目归属内容的读取 —— **本束不提供操作**。
   * Q-10 裁 A：把 phase-00 `readContent.in.projectId` 放开为 `nullable`，
   * 且**作为契约缺陷报告提给 `artifact` / `identity` 两束的签核人**，
   * **不由实现者顺手改**。见 `KNOWN_CONTRACT_GAPS.P8`。 */
} as const;

/**
 * 本束签核后 / 落地时撞到的契约缺口，逐条登记在契约自己身上。
 *
 * 放在这里而不是放在某个 report 里：report 会随着会话结束消失，
 * 而下一个动这份契约的人一定会打开这个文件。
 *
 * ⚠ 这不是 TODO 列表，是**需要人类签核才能补**的东西
 * （`design-signoff.md` 的 `status` 只能由人类改，agent 不许动）。
 */
export const KNOWN_CONTRACT_GAPS = {
  /**
   * **`ORG_ROLE_INSUFFICIENT` 在 phase-00 不存在。**
   * `usecases.md:54` 写着它「与 phase-00 同码同义」——核过了，那句话不成立：
   * `identity.PermissionReason` / `auth.AuthReason` / `0003-identity.sql` 全无此字面量。
   * 本文件是它的**第一处声明**。若签核人认为它应当归 `identity`（组织层判定本就归那束），
   * 那是**修订已签核束**，不是本束能做的。
   */
  P1: "ORG_ROLE_INSUFFICIENT is declared FIRST here; usecases.md claims it is same-code-same-meaning with phase-00, but no such literal exists in identity/auth/SQL",
  /**
   * **U-1 裁了非工作坊两类的成员形状，却没有任何操作。**
   * 裁决 B（各自一张成员表，`owner` / `collaborator` 两档）已由人类勾选，
   * 而 `usecases.md` 的 UC-P9 逐字写着「仅 `kind='workshop'`……另两类 → U-1 待裁，本文不写」——
   * 那句话写在裁决之前，**没有回头更新**。
   * ⇒ `NonWorkshopMemberRole` 有枚举无接口。加操作 = 签核后新增，需要重新签核。
   * ⚠ 不补的后果：`apps/web/lib/mock/itv.ts:26` 已自造三档视角（研究员/受访者/观察者）
   *   并自注「待迁入 packages/contracts」——那就是第二份事实源正在长出来的样子。
   */
  P2: "U-1 ruled the member model for research_project / user_insight (owner|collaborator), but usecases.md UC-P9 still says 'not written, pending U-1'; no operation exists for either container type",
  /**
   * **`ProvenanceEventType` 里没有项目生命周期的事件类型。**
   * 本束四个操作返回 `provenanceEventId`（I-P3 要求写审计、且**不许另造**审计表），
   * 但共享枚举里最接近的只有 `role-changed`（成员变更可用）。
   * 「项目已创建 / 已归档 / 已解归档 / 议程环节状态已变更」**四种事件无类型可写**。
   * ⇒ 加成员属修订已签核的 `provenance` 共享契约。
   */
  P3: "provenance.ProvenanceEventType has no member for project-created / project-archived / project-unarchived / agenda-segment-state-changed; this bundle returns provenanceEventId for all four",
  /**
   * **非 workshop 的 `kind` 能否接受 `blueprintVersionId`，仍无出处。**
   * 蓝本是工作坊机件；U-1 定了另两类各有成员表，但**没说它们有没有筹备机件**。
   * `createProject.in` 现在对三类一视同仁地收这个参数——**这是形状上的宽松，不是裁决**。
   */
  P4: "whether non-workshop kinds may carry blueprintVersionId is unruled (U-1 settled membership, not preparation machinery); the input currently accepts it for all three kinds",
  /**
   * **议程环节 `duration` 的单位无出处。** 原型只给「时长档位」。
   * 写成 `durationMinutes` 就是替人定了一个单位，写成 `duration` 则前后端各猜一次。
   * 取后者 + 登记，因为猜错单位在联调时会立刻暴露，而一个编出来的字段名不会。
   */
  P5: "AgendaSegment.duration has no documented unit; the prototype only shows a duration tier",
  /**
   * **准备度 / 完成度的分母表，项目侧那张是哪张，查不到出处。**
   * O-32 ④ 已裁口径（完成度 = 已完成项 / 已定义项，分母来自定义表），U-6 已确认它就是答案；
   * 蓝本侧的定义表存在（`ConfigItemDefinition`，`templates/domain.md:168` I-5 已有门控），
   * **项目筹备四子标签对应的那张表无出处**（U-6 第二格空白）。
   * ⇒ 概览与列表**都不带准备度**。在别处编一个分母就是第二份事实。
   */
  P6: "O-32 defines completion as done/defined items, but the project-side 'defined items' table has no source (U-6 second checkbox left blank); no readiness field is exposed",
  /**
   * **「有进行中环节时拒绝归档」的失败码没有名字。**
   * U-2⑵ 裁 a（拒绝归档）已被人类勾选，而该候选逐字写着「需要一个新码（本文**不命名**，等裁决）」，
   * `usecases.md` §3.2 的新增码清单里也没有它。
   * ⇒ `archiveProject.err` 现在**表达不了这个已裁定的失败**。本文件不发明它。
   */
  P7: "U-2(2) ruled 'reject archiving while a segment is active' but deliberately left the failure code unnamed; archiveProject.err cannot express it",
  /**
   * **`readContent.in.projectId` 仍是必填。**
   * Q-10 裁 A：放开为 `nullable`，且**作为契约缺陷报告提给 `artifact` / `identity`
   * 两束的签核人**，**不由实现者顺手改**（先例：`PermissionDecision.orgLayer.role` 与
   * `CapabilityListing.endpoint` 都是报上去改契约，不在实现里绕）。
   * 连带已定：无项目时 `projectLayer = null`（I-11），即只走组织层 + 个人层。
   */
  P8: "Q-10 ruled identity.readContent.in.projectId must become nullable; that is an amendment to a SIGNED bundle and is filed as a defect report, not applied here",
  /**
   * **创建的幂等键无出处。**
   * uc-00-1 E5 / V11 要求「同一次创建请求重复提交只建出一个项目」，
   * 而 `createProject.in` 里没有任何幂等键，`(orgId, name)` 唯一也没有出处。
   * ⇒ 幂等的判据留给实现 + F117 的验收，契约面**不替它编一个键**。
   */
  P9: "uc-00-1 E5/V11 require idempotent creation, but no idempotency key exists in the contract and no uniqueness rule has a source",
  /**
   * BP-08（createProject 真执行六类初始化，人类 2026-08-16 裁：最小闭环 B）落地时
   * 发现两处缺口，登记在一起因为同一根因（"六类初始化"的五个非议程类目从未有过
   * 真实存储，见 `project-prep-ports.ts` 头注 "F25-F28 建立"）：
   *
   * ① `BLUEPRINT_NOT_PUBLISHED` 对 `createProject` 而言是**已知不可达成员**（同 T10
   *   `TEMPLATE_SWITCH_FORBIDDEN_AFTER_START` 的先例）——`blueprintVersionId` 直接寻址
   *   一条 `blueprint_versions` 行，该表的 `state` CHECK 只允许 `published`/`archived`
   *   两值（草稿从不产生版本行），所以"解析到但未发布"这个状态在这条路径上不存在。
   *   保留该码是因为它与 `templates.applyBlueprint` 同码同义（该操作走 `versionId`
   *   可空的"当前已发布版本"语义，那条路径上这个码是真实可达的）。
   *
   * ② 🟢 **订正（2026-08-21，issue #1667）——"逐段时长无出处"这半句已经过时，不再成立**：
   *   `apps/web/components/tpl-designer/agenda-panel-editor.tsx`（F202，2026-08-18
   *   合入）把蓝本的「流程 Agenda」设计面从自由文本换成结构化表单，管理员真实填写
   *   逐环节 `min`（分钟），存进 `updateDesignFacet` 的 `flow-agenda` facet
   *   （JSON：`segments: [{ no, title, min, boardSkill, optional }]`）。P10 这半句是
   *   在 F202 落地**之前**写的，当时确实没有任何数据源——静态痕迹（这句注释）没有跟着
   *   动态事实（F202 已上线）一起更新，属本仓「静态痕迹 ≠ 动态事实」的又一例，
   *   只是这次是**契约里登记的缺口本身**过期了，不是 feature 状态被误判。
   *
   *   `templates.applyBlueprint`（F23 补实现，issue #1667）现在真实读取
   *   `resolvedVersion.content['flow-agenda']`、按位置对齐解析出每一行的 `min`，
   *   写进 `agenda_segments.duration`（该列已随本次改动放开 `NOT NULL`，未填的行
   *   如实留 `NULL`，不编造默认值——见
   *   `apps/api/migrations/20260821090000_i1667_apply_blueprint_infra.sql` 与
   *   `apps/api/src/domain/templates/flow-agenda-durations.ts`）。
   *
   *   `createProject`（BP-08，本条目①描述的路径）**仍然**只写 `blueprint_bindings`
   *   一行、不落地真实 `agenda_segments` 行——这是本条目未变的部分，不是本次订正的
   *   范围：BP-08 的六类初始化范围本就比 `templates.applyBlueprint` 窄（同 T9 的
   *   既有登记），这次订正只解决"时长有没有数据源"这个技术性前提，不推翻 BP-08 的
   *   既有范围裁决——BP-08 若要跟进落地真实议程环节写入，是它自己的后续 feature。
   */
  P10: "createProject cannot reach BLUEPRINT_NOT_PUBLISHED (blueprintVersionId addresses a blueprint_versions row directly, whose state is always published/archived when it exists) -- kept for same-code-same-meaning with templates.applyBlueprint, which CAN reach it via nullable versionId; separately, BP-08's six-category init still writes only the blueprint_bindings fact -- but the other half of this entry (\"per-segment duration has no source anywhere\") is RESOLVED as of 2026-08-21 (issue #1667): F202 (2026-08-18) gave the flow-agenda design facet a real structured `segments[].min` field, and templates.applyBlueprint now reads it (agenda_segments.duration is nullable; unfilled rows stay NULL, no invented default) -- BP-08's createProject path is unchanged and still does not write real agenda_segments rows, which remains its own known, separate scope decision, not a data-availability blocker",
} as const;
