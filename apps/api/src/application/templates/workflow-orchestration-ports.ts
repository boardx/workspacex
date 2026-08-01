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

/** `[另存为组织模板]` 的唯一写入口——**没有**对应的「读来源模板」方法，见该用例文件头注。 */
export interface OrgTemplateCreatePort {
  create(input: {
    readonly orgId: string;
    readonly name: string;
    readonly segments: readonly AgendaSegmentRefLike[];
    readonly matrix: readonly MatrixCellLike[];
  }): Promise<{ readonly workflowTemplateId: string }>;
}
