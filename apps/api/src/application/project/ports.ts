/**
 * F117 的仓储端口。由 application 定义，`infrastructure` 实现（依赖倒置）。
 *
 * ## 为什么只有一个方法，而且它把两行写入包在里面
 *
 * 端口若长成 `insertProject()` + `insertSubtypeRow()` 两个方法，「原子」就变成了
 * **调用方的自觉**——而调用方是一段能被下一个人重排的代码。I-P34 想排除的
 * 「有容器没子类型」中间态，在那种端口形状下**表达得出来**，因此迟早会出现。
 *
 * 一个方法 = 事务边界属于实现，调用方连拆开的语法都没有。
 * （同 `IdentityRepository.ensurePersonalLocalOrg` 的理由：返回容器而不是
 *  「我建了吗」的布尔，因为分支到「只在首次创建时做某事」的调用方一定会出现，
 *  而首次创建在重放下不可观测。）
 *
 * ⚠ 这里**没有** `grantProjectRole`：Q-4② 裁「创建者不自动获角色」。
 *   给一个不该发生的动作留个端口，下一个人会以为它只是还没被调用。
 */
import type { z } from "zod";
import { project } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import type { DurationTier, CategoryInitCount } from "../../domain/templates/apply-blueprint-init";
import type { ProjectKind } from "../../domain/project/create-project-rules";

export interface CreateProjectCommand {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly name: string;
  readonly kind: ProjectKind;
  /** null = 空白新建（Q-1 C）。⚠ 六类初始化**跳过**而非写空值，所以这里不造默认值。 */
  readonly blueprintVersionId: string | null;
  /** `domain/project/create-project-rules.ts` 算出来的指纹。仓储不自己算——两处算就是两份判据。 */
  readonly fingerprint: string;
  /**
   * BP-08（人类 2026-08-16 裁：最小闭环 B）——非 null 时同一事务里额外写一行
   * `blueprint_bindings`（`kind='project'`），记录"这个蓝本被套用了"的事实。
   * ⚠ 本轮**不写**任何 `agenda_segments`（六类初始化的"议程环节"一类）：
   * 逐段时长无出处（`KNOWN_CONTRACT_GAPS.P10`），本轮不发明。表/列已就绪
   * （`blueprint_bindings.kind` 的 CHECK 早已包含 `'project'`，BP-04/F179 迁移），
   * 零新增存储。
   */
  readonly blueprintBinding: { readonly blueprintId: string } | null;
}

export interface CreatedProject {
  readonly id: string;
  readonly kind: ProjectKind;
  readonly status: "active" | "archived";
  /**
   * false = 这一次是**重放**，返回的是先前那个容器。
   *
   * ⚠ 它在响应体里没有对应字段（契约 `createProject.out` 是 `.strict()` 的，
   *   四个字段里没有它），存在的唯一理由是让幂等在**测试里可断言**：
   *   只断言「两次调用的 id 相同」时，一个「每次都新建、但 id 由 name 派生」的
   *   实现也会全绿，而它其实建了两行。
   */
  readonly created: boolean;
  /**
   * BP-08：`blueprintVersionId` 非 null 时的六类初始化摘要，与 `getInitializationPreview`
   * 同一个 planner（`planSixCategoryInit`）产出，六类计数逐项对得上（AC2）。
   * ⚠ **不进契约响应体**——`createProject.out` 是 `.strict()` 四字段，本轮未走新的
   * 契约 delta 加字段（范围收紧到最小闭环）；只在应用层返回值里给内部消费方/测试
   * 核对用。空白新建（`blueprintVersionId === null`）时为 `undefined`。
   */
  readonly initialized?: readonly CategoryInitCount[];
}

/**
 * BP-08 的只读解析端口——由 `createProject` 在写入前调用，判"这个 blueprintVersionId
 * 能不能用来建项目"。**故意不是** `ProjectRepository` 的一部分：这是一次跨束读
 * （读 `templates` 束的 `blueprint_versions`/`blueprints` 表），与「项目容器怎么原子写」
 * 是两件不相关的事，混进同一个接口会让两边的 `lint-permission-paths` 豁免绑在一起。
 */
export type ResolveBlueprintReferenceOutcome =
  | {
      readonly kind: "ok";
      readonly blueprintId: string;
      /** 该版本冻结快照里已填的设计配置项 key（不是当前草稿——快照不漂移，I-1）。 */
      readonly filledFacetKeys: readonly string[];
      /**
       * ⚠ 活表 `blueprints.duration_tier` 当前值，**不是**版本快照里的档位——版本快照
       * 从未冻结过档位（`KNOWN_CONTRACT_GAPS.T15`，人类 2026-08-16 裁：本轮按活表走，
       * 登记为已知缺口，不假装快照里有）。
       */
      readonly tier: DurationTier;
    }
  /** 不存在或越权可见，两者不可区分，不泄露资源存在性（同 `templates` 束同一条纪律）。 */
  | { readonly kind: "not-found" }
  /**
   * team-only 且调用者不在该 team。⚠ 当前系统蓝本 `scope` 恒 `org-wide`（BP-01 尚无
   * 可见性写入路径），这一支**今天不可达**——实现仍然判它，是为了可见性写入路径
   * 落地那天不必回头改这段编排（同 `blueprint.controller.ts` 的 `list()` 先例）。
   */
  | { readonly kind: "not-visible" }
  /** 传入版本已归档，本次是**新增绑定**（I-7 只允许存量绑定继续实例化）。 */
  | { readonly kind: "version-archived" };

export interface BlueprintReferenceRepository {
  resolve(
    orgId: OrgId,
    blueprintVersionId: string,
    actorOrgRole: OrgRole | null,
    actorTeamId: string | null,
  ): Promise<ResolveBlueprintReferenceOutcome>;
}

export const BLUEPRINT_REFERENCE_REPOSITORY = Symbol("BlueprintReferenceRepository");

/**
 * 六类写入部分失败（本轮范围内实际只可能是 `blueprint_bindings` 那一行写入失败，
 * 例如蓝本在解析后、写入前被并发删除——`23503` 外键违反）。整个 `create()` 事务
 * 已回滚（不留半成品项目行），仓储抛这个类，`create-project.ts` 翻译成
 * `INITIALIZATION_FAILED`。
 */
export class BlueprintBindingFailedError extends Error {
  constructor() {
    super("blueprint binding insert failed; transaction rolled back as a whole");
    this.name = "BlueprintBindingFailedError";
  }
}

export interface ProjectRepository {
  /**
   * **一个事务，两行**（BP-08 起，`blueprintVersionId` 非 null 时是三行）：
   * `projects` 一行 + 对应子类型表一行 + 重放表一行 + （可选）`blueprint_bindings` 一行。
   *
   * 幂等由重放表的**主键冲突**保证，不是先查后写：先查后写在并发下两路都会
   * 读到「没有」，然后都写（`ProjectReason.SEGMENT_ALREADY_ACTIVE` 那条注释里的同一个坑）。
   */
  create(cmd: CreateProjectCommand): Promise<CreatedProject>;
}

export const PROJECT_REPOSITORY = Symbol("ProjectRepository");

/* ═══════════════════════ F122：`listProjects` 的独立端口 ═══════════════════════ */

/**
 * ⚠ **故意不是 `ProjectRepository` 的第二个方法**，是一个新接口、新文件、新 DI token。
 *
 * `pg-project-repository.ts` 在 `lint-permission-paths.mjs` 的白名单里，理由逐字是
 * 「a WRITE path plus ONE echo of the caller's own request」，且
 * `tests/project/create-project-idempotent.test.ts` 有一条断言钉死那个文件**只能有
 * 一条 SELECT**。把两段列表查询（至少两条新 SELECT）塞进同一个文件，会让那条
 * 「只有一条回声 SELECT」的断言失去意义——继续放行就是把断言改弱去迁就新代码，
 * 而不是新代码去满足断言。⇒ 新增一个仓储、新增一条白名单条目，各自的豁免各自成立。
 */
export interface ProjectListRow {
  readonly id: string;
  readonly name: string;
  readonly kind: ProjectKind;
  readonly status: "active" | "archived";
  /** 供 `domain/project/readonly-reason.ts` 判只读原因；响应体本身不暴露组织状态。 */
  readonly orgStatus: "active" | "disabled";
}

export interface ListProjectsForActorQuery {
  readonly orgId: OrgId;
  readonly actorId: string;
  /** `true` = 调用者组织角色是 `lead` 或 `admin`，本次要查 `managed` 段；
   *  `false` 时 `managed` 恒为 `[]`——**不查**，不是查了个空结果。 */
  readonly isManager: boolean;
}

export interface ProjectListRepository {
  /**
   * UC-P2 `listProjects` 的两段查询。**一次仓储调用查完两段**，不是两个方法：
   * 拆成两个方法，调用方就要自己决定「先查哪个、`isManager=false` 时要不要调第二个」，
   * 而「不查」和「查了返回空」在契约层面看起来一样，容易被静默地都实现成后者。
   */
  listForActor(query: ListProjectsForActorQuery): Promise<{
    readonly member: readonly ProjectListRow[];
    readonly managed: readonly ProjectListRow[];
  }>;
}

export const PROJECT_LIST_REPOSITORY = Symbol("ProjectListRepository");

/* ═══════════════════════ F119：`advanceAgendaSegment` 的独立端口 ═══════════════════════ */

/**
 * ⚠ **故意不是 `ProjectRepository` 的第三个方法**：同 F122 那条端口分裂的理由——
 * 这个仓储写的是 `agenda_segments`，不是 `projects`，各自的 `lint-permission-paths`
 * 豁免各自成立，混进同一个文件会让两条互不相关的断言绑在一起。
 */
export interface AgendaSegmentRow {
  readonly id: string;
  readonly workshopId: string;
  readonly ordinal: number;
  readonly title: string;
  readonly duration: number;
  readonly state: "pending" | "active" | "closed" | "skipped";
  readonly mergedInto: string | null;
  readonly agendaSegmentDefinitionId: string | null;
  readonly acceptedSources: readonly string[];
}

export interface AdvanceAgendaSegmentCommand {
  readonly orgId: OrgId;
  readonly workshopId: string;
  readonly segmentId: string;
  readonly actorId: string;
  /** 由 `domain/project/advance-segment-outcomes.ts` 算出来，仓储不自己判定终态。 */
  readonly nextState: "closed" | "skipped";
  readonly mergedInto: string | null;
}

export interface AdvanceAgendaSegmentResult {
  /** 被推进/结束/跳过/合并的那一条环节，终态已生效。 */
  readonly segment: AgendaSegmentRow;
  /**
   * 按 `ordinal` 紧邻其后、状态为 `pending` 的下一条环节被置为 `active` 的结果；
   * 没有下一条（本环节是工作坊最后一条）时为 `null`——**不是**报错，是正常的收尾状态。
   */
  readonly activatedNext: AgendaSegmentRow | null;
}

/** #627 `createAgendaSegment`（UC-P6）的写入命令。`id` 不在这里——仓储自己生成，同 `CreateProjectCommand` 的先例。 */
export interface CreateAgendaSegmentCommand {
  readonly orgId: OrgId;
  readonly workshopId: string;
  readonly agendaSegmentDefinitionId: string | null;
  readonly ordinal: number;
  readonly title: string;
  readonly duration: number;
}

/**
 * #627：三态结果，同 `member-ports.ts` 的 `AddMemberOutcome` 同一形状/同一理由——
 * 「工作坊已归档」由 F124 的 RESTRICTIVE INSERT 策略拒写（`kernel_project_is_writable`，
 * `42501`），「工作坊不存在」由复合外键拒写（`23503`）；仓储把两种驱动异常翻译成
 * 判别式，调用方（application 层）不用去猜 Postgres 错误码。
 */
export type CreateAgendaSegmentOutcome =
  | { readonly kind: "created"; readonly row: AgendaSegmentRow }
  /** 工作坊不存在（`23503`）。同 `AddMemberOutcome.not-found` 的先例：不额外暴露存在性区别。 */
  | { readonly kind: "not-found" }
  /** 工作坊已归档（`42501`，F124 的 `agenda_segments_project_archived_ins` 策略）。 */
  | { readonly kind: "archived" };

export interface AgendaSegmentRepository {
  findById(orgId: OrgId, workshopId: string, segmentId: string): Promise<AgendaSegmentRow | null>;

  /**
   * 一个事务内完成：① 当前环节改终态 ② 紧邻的下一条 `pending` 环节（若存在）置 `active`。
   * ⚠ ②与 F118 的部分唯一索引 `agenda_segments_one_active_per_workshop` 是同一件事的两面：
   *   两个并发的 `advance` 调用各自试图激活下一条，索引保证恰好一个成功，
   *   另一个在这里应当收到 `23505`——由调用方（application 层）翻译成 `SEGMENT_ALREADY_ACTIVE`，
   *   仓储只负责把驱动错误原样抛出，不在这里吞掉再自造一个语义。
   */
  advance(cmd: AdvanceAgendaSegmentCommand): Promise<AdvanceAgendaSegmentResult>;

  /**
   * #627：新建一条环节，初始 `state='pending'`。**不**先 `SELECT` 工作坊是否存在/是否
   * 归档再决定要不要写——同 `advance` 头注「不在应用层再判一次」的同一条纪律，交给
   * 数据库的外键与 F124 的 RESTRICTIVE 策略在同一条 `INSERT` 里判定，仓储只翻译驱动
   * 异常。`id` 由仓储生成（`IdFactory`），同 `PgProjectRepository.create` 的先例。
   */
  create(cmd: CreateAgendaSegmentCommand): Promise<CreateAgendaSegmentOutcome>;

  /**
   * #853：`listAgendaSegments`（UC-P6，契约 `project.ts` 里与 `createAgendaSegment` 同一次
   * 签核、同一张表，但此前**从未实现**——全仓零 controller、零 application 用例）。
   * 缺口本身是 #853 的发现：没有它，前端建出来的环节（初始 `pending`）在任何真实读路径
   * 里都不可见（`getProjectOverview` 只回 `state='active'` 那一条），「建了 → 刷新 → 还在」
   * 这条闭环因此做不出来。补的是**实现缺口**，不是设计缺口，同 `create()` 那条注释
   * 同一条纪律（`createAgendaSegment` 本身当年就是这样补的，见 #627）。
   *
   * 按 `ordinal` 升序返回**全部**环节（不筛状态）——契约 `listAgendaSegments.out` 是
   * `z.array(AgendaSegment)`，没有分页/筛选参数，筛出一部分就是在这里发明一份契约
   * 没有的过滤规则。
   */
  list(orgId: OrgId, workshopId: string): Promise<readonly AgendaSegmentRow[]>;
}

export const AGENDA_SEGMENT_REPOSITORY = Symbol("AgendaSegmentRepository");

/* ═══════════════════════ F123：`getProjectOverview` 的独立端口 ═══════════════════════ */

/**
 * ⚠ 同 F122 那条注释的理由：不是 `ProjectRepository` 或 `ProjectListRepository` 的
 * 第三个方法，是一个新接口、新文件、新 DI token——三个仓储各自的
 * `lint-permission-paths` 豁免各自成立，理由各不相同（见
 * `infrastructure/project/pg-project-overview-repository.ts` 文件头）。
 *
 * `z.infer<typeof project.X>`，不是本文件手写字面量类型：契约的 `AgendaSegment` /
 * `WorkshopRoleCounts` 是这两个形状的唯一事实源（同本文件 `ProjectKind` 的引用方式）。
 */
export type OverviewAgendaSegment = z.infer<typeof project.AgendaSegment>;
export type OverviewRoleCounts = z.infer<typeof project.WorkshopRoleCounts>;

export interface ProjectSnapshotRow {
  readonly name: string;
  readonly kind: ProjectKind;
  readonly status: "active" | "archived";
}

export interface ProjectOverviewRepository {
  /** 容器身份三件：名字 / kind / 状态。不存在返回 `null`（同容器不存在时的既有处理）。 */
  getProjectSnapshot(orgId: OrgId, projectId: string): Promise<ProjectSnapshotRow | null>;

  /**
   * 当前议程环节 —— 同一工作坊内 `state='active'` 至多一条（I-P44 的部分唯一索引），
   * 没有时返回 `null`。⚠ 只对 `kind='workshop'` 的容器调用，调用方负责判 kind。
   */
  getCurrentAgendaSegment(orgId: OrgId, workshopId: string): Promise<OverviewAgendaSegment | null>;

  /**
   * 四类项目角色人数。⚠ 只对 `kind='workshop'` 的容器调用；没有任何成员时四个计数皆为 0，
   * 不是 `null`——「工作坊存在但还没人」与「这不是工作坊」是两件不同的事，
   * 后者才是 `roleCounts: null`（契约 `getProjectOverview.out` 逐字）。
   */
  getWorkshopRoleCounts(orgId: OrgId, projectId: string): Promise<OverviewRoleCounts>;
}

export const PROJECT_OVERVIEW_REPOSITORY = Symbol("ProjectOverviewRepository");

/* ═══════════════════════ F124：`archiveProject` / `unarchiveProject` 的独立端口 ═══════════════════════ */

/**
 * ⚠ 故意也不是 `ProjectRepository` 的第四个方法，理由同 F122/F123 那两条——
 * `pg-project-repository.ts` 被钉死「只有一条 `INSERT INTO projects`」，归档/解归档
 * 是 `UPDATE`，各自的 `lint-permission-paths` 豁免各自成立，不合并。
 *
 * ⚠ 「有 active 议程环节时拒绝归档」（U-2⑵）的判定与「读状态 + 写状态」放在**同一次
 * 仓储调用**里完成，不是应用层先查一次环节表、再查一次项目状态、再决定写不写——
 * 先查后写在并发下会读到「此刻没有 active 环节」然后写，而写入完成前另一个请求
 * 刚把某个环节推进为 `active`（`SEGMENT_ALREADY_ACTIVE` 那条契约注释点过名的同一类
 * 竞态）。仓储把「检查 + 更新」放进一次事务，由数据库的可见性规则保证不出现
 * 「归档了，但恰好有一条环节还在 active」的中间态。
 */
export type ArchiveOutcome =
  | { readonly kind: "archived"; readonly projectId: string }
  /** 容器不存在。契约 `archiveProject.err` 没有 NOT_FOUND，同 `create-project.ts`
   *  「非成员与非 lead 同码」的先例，由 application 并入 `ORG_ROLE_INSUFFICIENT`。 */
  | { readonly kind: "not-found" }
  /** 已经是 archived —— `archiveProject.err` 的 `PROJECT_ARCHIVED` 就是为这条准备的
   *  （契约文件头「对 archived 容器写入」覆盖「再次归档」这一特例）。 */
  | { readonly kind: "already-archived" }
  /** U-2⑵ 已裁「拒绝」，但失败码故意没有名字（`KNOWN_CONTRACT_GAPS.P7`）。application
   *  层为它抛一个**不在** `ProjectReason` 里的本地错误，见 `./errors.ts` 的
   *  `ProjectArchiveBlockedError`——本仓储只负责把这个判定结果如实报出来。 */
  | { readonly kind: "active-segment-exists" };

export type UnarchiveOutcome =
  | { readonly kind: "unarchived"; readonly projectId: string }
  | { readonly kind: "not-found" };

export interface ProjectArchiveRepository {
  /** 一次调用完成：读容器状态 + 判断有无 `active` 议程环节 + 满足条件时写 `archived`。 */
  archive(orgId: OrgId, projectId: string): Promise<ArchiveOutcome>;

  /**
   * **无条件幂等**（同 F22 `OrgLifecycleRepository.reactivate` 的先例）：项目已是
   * `active` 时再解归档直接返回当前状态，不报错——契约 `unarchiveProject.err` 里
   * 没有「已经是 active」这个码，本仓储不发明一个。
   */
  unarchive(orgId: OrgId, projectId: string): Promise<UnarchiveOutcome>;
}

export const PROJECT_ARCHIVE_REPOSITORY = Symbol("ProjectArchiveRepository");
