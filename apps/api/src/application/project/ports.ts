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
import type { OrgId } from "../../domain/org-id";
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
}

export interface ProjectRepository {
  /**
   * **一个事务，两行**：`projects` 一行 + 对应子类型表一行 + 重放表一行。
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
}

export const AGENDA_SEGMENT_REPOSITORY = Symbol("AgendaSegmentRepository");
