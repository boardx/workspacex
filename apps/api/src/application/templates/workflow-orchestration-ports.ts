/**
 * F26 的仓储/目录端口 —— `templates` 束「工作流编排」四个操作共用的 I/O 边界。
 *
 * 同 `apply-blueprint-ports.ts` 头注的先例：应用层只声明**要什么**，怎么存（PostgreSQL
 * 表结构、乐观并发用哪种锁）留给未来的 `infrastructure/templates` 实现——本仓这个阶段的
 * `templates` 束尚无任何一个操作接了真实存储层（`apply-blueprint.ts` / `set-duration-tier.ts`
 * 同样如此），F26 不领先它们去建。
 */
import type { AgendaSegmentRefLike } from "../../domain/templates/duration-tier";
import type {
  MatrixCellLike,
  WorkflowOrchestrationSnapshot,
} from "../../domain/templates/workflow-orchestration";
import type { OrgId } from "../../domain/org-id";

/** 项目侧实例编排的读写面。 */
export interface OrchestrationRepository {
  /** null = 该项目尚无实例编排（例如 F23 套用尚未完成）。 */
  load(projectId: string): Promise<WorkflowOrchestrationSnapshot | null>;
  /**
   * 整份覆盖式保存（换模板专用）。⚠ 契约 `switchWorkflowTemplate.err` 里**没有**
   * `VERSION_CHANGED`——换模板是一次全量替换，不做单格粒度的乐观并发比对；
   * 并发下「谁的换模板最后写入生效」不是本用例的判定范围。
   */
  replace(projectId: string, snapshot: WorkflowOrchestrationSnapshot): Promise<void>;
  /**
   * 单格更新（`updateMatrixCell` 专用）。⚠ `expectedRevision` 不匹配当前存量
   * ⇒ 返回 `{ ok: false }`，调用方翻译成 `VERSION_CHANGED`，**不得静默覆盖**
   * （同 `upsert-segment-binding.ts` 的乐观并发同一条纪律）。
   */
  upsertCell(
    projectId: string,
    cell: MatrixCellLike,
    expectedRevision: string,
  ): Promise<{ readonly ok: true; readonly revision: string } | { readonly ok: false }>;
}

/** 后台工作流模板库的一条目录项 —— 换模板 / 读模板库都从这里查。 */
export interface WorkflowTemplateCatalogEntry {
  readonly templateId: string;
  readonly name: string;
  readonly sourceVersion: number;
  readonly segments: readonly AgendaSegmentRefLike[];
  readonly matrix: readonly MatrixCellLike[];
}

export interface WorkflowTemplateCatalogPort {
  /** null = 模板不存在或对调用者不可读。 */
  load(templateId: string): Promise<WorkflowTemplateCatalogEntry | null>;
}

/**
 * #1680 gap-fill：`OrchestrationRepository` / `WorkflowTemplateCatalogPort` 的方法签名
 * 都不带 `orgId`（见上方两个接口），而真实存储层的 RLS 隔离必须知道租户——这两个工厂
 * 接口是 DI 组装（无请求上下文）与端口消费（有 `orgId`，来自 `principal.orgId`）之间
 * 的组合点：控制器每次请求用 `forOrg(orgId)` 现场绑出一份满足端口接口的适配器，而不是
 * 直接把 PostgreSQL 实现类型（`infrastructure/`）导入 `interface/controllers/`——
 * 那会让控制器绕过应用层端口去认识一个具体存储实现，违反本仓洋葱架构的既有边界
 * （`interface` 只认 `application` 的端口/令牌，从不 `import` `infrastructure` 里的类）。
 */
export interface OrchestrationRepositoryFactory {
  forOrg(orgId: OrgId): OrchestrationRepository;
}
export const ORCHESTRATION_REPOSITORY_FACTORY = Symbol("OrchestrationRepositoryFactory");

export interface WorkflowTemplateCatalogFactory {
  forOrg(orgId: OrgId): WorkflowTemplateCatalogPort;
}
export const WORKFLOW_TEMPLATE_CATALOG_FACTORY = Symbol("WorkflowTemplateCatalogFactory");

/** `[另存为组织模板]` 的唯一写入口——**没有**对应的「读来源模板」方法，见该用例文件头注。 */
export interface OrgTemplateCreatePort {
  create(input: {
    readonly orgId: string;
    readonly name: string;
    readonly segments: readonly AgendaSegmentRefLike[];
    readonly matrix: readonly MatrixCellLike[];
  }): Promise<{ readonly workflowTemplateId: string }>;
}

/**
 * #1680 gap-fill：`OrgTemplateCreatePort` 的 DI 令牌。
 *
 * ⚠ `OrchestrationRepository` / `WorkflowTemplateCatalogPort` 故意**没有**同款令牌——
 * 两者的方法签名不带 `orgId`（见上方接口定义），PG 实现因此不能直接满足接口；
 * 控制器改为注入各自的具体类（`PgOrchestrationRepository` / `PgWorkflowTemplateCatalogRepository`，
 * `infrastructure/templates/pg-workflow-orchestration-repository.ts`）并按请求的
 * `orgId` 用 `.forOrg(orgId)` 现场绑出一份满足接口的适配器——这是绑定 `orgId` 的
 * 组合点，不是端口签名的一部分，所以不在这里加令牌。`OrgTemplateCreatePort.create`
 * 不受影响：它的入参本就带 `orgId`，PG 实现可以直接 `implements` 这个接口。
 */
export const ORG_TEMPLATE_CREATE_PORT = Symbol("OrgTemplateCreatePort");

/* ═══════════════════════ F27：矩阵格 → 待办同步的端口 ═══════════════════════ */

/**
 * 「这一格（环节 × 角色）此刻该由谁负责」——跨束边（人员归属属 identity/11-board，
 * 不属 `templates` 束）。⚠ 与 `MatrixTaskPublisherPort` 的 `executorAgentId`
 * 结构性分离，理由同 `skill/ports.ts` `RoleAssigneePort` 头注：D-39「负责人恒为人」
 * 要求两者来自互不相交的两个来源，糊不到一起去。
 */
export interface MatrixRoleAssigneePort {
  assigneeOf(input: {
    readonly projectId: string;
    readonly agendaSegmentId: string;
    readonly roleKey: string;
  }): Promise<{ readonly principalId: string } | null>;
}

/**
 * 矩阵格 ↔ 待办卡的发布/移除端口（I-23：可追溯的一一对应）。
 *
 * ⚠ `upsertForCell` 必须按 `(projectId, cellId)` 做**键控 upsert**——重复以相同
 *   `cellId` 调用必须落到同一张待办卡（幂等，不产生重复卡），这是契约「重复触发
 *   同步不产生重复卡」在这个端口形状下的落点，不是应用层自己去查重。
 * ⚠ `removeForCell` 必须幂等：对没有已同步待办的 `cellId` 调用等同 no-op（返回
 *   `removed: false`），不得抛错——「格子从未同步过就被删」是正常路径（例如格子
 *   从未填过内容就被移除）。
 */
export interface MatrixTaskPublisherPort {
  upsertForCell(input: {
    readonly projectId: string;
    readonly cellId: string;
    readonly agendaSegmentId: string;
    readonly roleKey: string;
    readonly content: string;
    /** ⚠ D-39：只能来自 `MatrixRoleAssigneePort`。 */
    readonly assigneePrincipalId: string;
    readonly executorAgentId: string | null;
  }): Promise<
    | { readonly ok: true; readonly todoId: string; readonly created: boolean }
    | { readonly ok: false }
  >;

  removeForCell(
    projectId: string,
    cellId: string,
  ): Promise<{ readonly ok: true; readonly removed: boolean } | { readonly ok: false }>;
}
