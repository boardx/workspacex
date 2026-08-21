/**
 * #1680 gap-fill —— F26 三个端口（`OrchestrationRepository` / `WorkflowTemplateCatalogPort` /
 * `OrgTemplateCreatePort`）的 PostgreSQL 实现。三个用例（`saveAsOrgTemplate` /
 * `switchWorkflowTemplate` / `getWorkflowOrchestration`）此前只有内存 Fake 撑单测，
 * `infrastructure/` 下零实现、`interface/controllers/` 下零控制器（#1680 勘探结论）。
 *
 * ## 为什么 `PgOrchestrationRepository` / `PgWorkflowTemplateCatalogRepository`
 *   不写成 `implements OrchestrationRepository` / `implements WorkflowTemplateCatalogPort`
 *
 * 两个端口的方法签名（`load(projectId)`、`replace(projectId, snapshot)`、
 * `upsertCell(projectId, cell, expectedRevision)`、`load(templateId)`）**都不带 `orgId`**——
 * `application/templates/workflow-orchestration-ports.ts` 是纯应用层设计，没有替
 * infra 操心「RLS 需要哪个租户」。但 `DatabasePort.withTenant` 强制要求调用方现场
 * 给出 `orgId`（`database.port.ts` 头注：这是刻意的可读性设计，不是遗漏），而
 * `projects` 表本身也在 RLS 之下（`0003-identity.sql` 的通用租户循环）——没有 `orgId`
 * 连「这个 projectId 属于哪个组织」都查不出来，鸡生蛋。
 *
 * 于是这里的类持有**真实签名**（多一个 `orgId` 参数），`forOrg(orgId)` 现场绑出一个
 * 满足端口接口的适配器对象——绑定 `orgId` 这件事发生在控制器每次请求时（已知
 * `principal.orgId`），不是发生在 DI 组装时（那时还没有请求，绑不出 `orgId`）。
 * 同 `blueprint.controller.ts` 里全部路由都用 `principal.orgId` 而不去反查
 * `projectId → orgId` 的既有惯例——项目所属组织即调用者当前组织，这是当前会话模型下
 * 的既有事实，不是本文件新做的裁决。
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import { toOrgId } from "../../domain/org-id";
import type {
  OrchestrationRepository,
  OrchestrationRepositoryFactory,
  OrgTemplateCreatePort,
  WorkflowTemplateCatalogEntry,
  WorkflowTemplateCatalogFactory,
  WorkflowTemplateCatalogPort,
} from "../../application/templates/workflow-orchestration-ports";
import {
  upsertMatrixCell,
  type MatrixCellLike,
  type WorkflowOrchestrationSnapshot,
} from "../../domain/templates/workflow-orchestration";
import type { AgendaSegmentRefLike } from "../../domain/templates/duration-tier";
import type { IdFactory } from "../../application/artifact/ports";

interface OrchestrationRow {
  template_id: string;
  template_name: string;
  template_source_version: number;
  segments: AgendaSegmentRefLike[];
  matrix: MatrixCellLike[];
  revision: string;
}

function toSnapshot(row: OrchestrationRow): WorkflowOrchestrationSnapshot {
  return {
    template: {
      templateId: row.template_id,
      name: row.template_name,
      sourceVersion: row.template_source_version,
    },
    segments: row.segments,
    matrix: row.matrix,
    revision: row.revision,
  };
}

export class PgOrchestrationRepository implements OrchestrationRepositoryFactory {
  constructor(private readonly db: DatabasePort) {}

  async load(orgId: OrgId, projectId: string): Promise<WorkflowOrchestrationSnapshot | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<OrchestrationRow>(
        `SELECT template_id, template_name, template_source_version, segments, matrix, revision
           FROM project_workflow_orchestration WHERE project_id = $1`,
        [projectId],
      );
      const row = r.rows[0];
      return row === undefined ? null : toSnapshot(row);
    });
  }

  /**
   * 整份覆盖式保存（换模板专用）。⚠ 无乐观并发比对——见端口文件头注与本迁移文件头注：
   * `replace` 是全量替换，`revision` 只是「写一个新值供下次 `upsertCell` 用」，不比对旧值。
   */
  async replace(orgId: OrgId, projectId: string, snapshot: WorkflowOrchestrationSnapshot): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO project_workflow_orchestration
           (project_id, org_id, template_id, template_name, template_source_version, segments, matrix, revision)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
         ON CONFLICT (project_id) DO UPDATE SET
           template_id = excluded.template_id,
           template_name = excluded.template_name,
           template_source_version = excluded.template_source_version,
           segments = excluded.segments,
           matrix = excluded.matrix,
           revision = excluded.revision,
           updated_at = now()`,
        [
          projectId,
          orgId,
          snapshot.template.templateId,
          snapshot.template.name,
          snapshot.template.sourceVersion,
          JSON.stringify(snapshot.segments),
          JSON.stringify(snapshot.matrix),
          snapshot.revision,
        ],
      );
    });
  }

  /**
   * 单格更新（F27 `updateMatrixCell` 消费，本 gap-fill 未接控制器，但端口必须完整实现）。
   * CAS 同 `pg-blueprint-repository.ts` `updateDesignFacet` 的先例：`SELECT ... FOR UPDATE`
   * 读快照、应用层比对 `revision`，不用 `UPDATE ... WHERE revision = $expected`（那种写法
   * 分不清「项目还没套过模板」与「版本不对」两种 0 行结果）。矩阵合并复用领域纯函数
   * `upsertMatrixCell`（同键覆盖否则追加），不在这里另写一份合并逻辑。
   */
  async upsertCell(
    orgId: OrgId,
    projectId: string,
    cell: MatrixCellLike,
    expectedRevision: string,
  ): Promise<{ readonly ok: true; readonly revision: string } | { readonly ok: false }> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ matrix: MatrixCellLike[]; revision: string }>(
        `SELECT matrix, revision FROM project_workflow_orchestration WHERE project_id = $1 FOR UPDATE`,
        [projectId],
      );
      const row = r.rows[0];
      if (row === undefined) return { ok: false };
      if (row.revision !== expectedRevision) return { ok: false };

      const nextMatrix = upsertMatrixCell(row.matrix, cell);
      const updated = await s.query<{ revision: string }>(
        `UPDATE project_workflow_orchestration SET matrix = $2::jsonb, revision = $3, updated_at = now()
           WHERE project_id = $1 RETURNING revision`,
        [projectId, JSON.stringify(nextMatrix), randomUUID()],
      );
      return { ok: true, revision: updated.rows[0]!.revision };
    });
  }

  /** 现场绑一个 `orgId`，产出满足 `OrchestrationRepository` 接口的适配器——见文件头注。 */
  forOrg(orgId: OrgId): OrchestrationRepository {
    return {
      load: (projectId) => this.load(orgId, projectId),
      replace: (projectId, snapshot) => this.replace(orgId, projectId, snapshot),
      upsertCell: (projectId, cell, expectedRevision) =>
        this.upsertCell(orgId, projectId, cell, expectedRevision),
    };
  }
}

interface CatalogRow {
  id: string;
  name: string;
  source_version: number;
  segments: AgendaSegmentRefLike[];
  matrix: MatrixCellLike[];
}

export class PgWorkflowTemplateCatalogRepository implements WorkflowTemplateCatalogFactory {
  constructor(private readonly db: DatabasePort) {}

  async load(orgId: OrgId, templateId: string): Promise<WorkflowTemplateCatalogEntry | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<CatalogRow>(
        `SELECT id, name, source_version, segments, matrix
           FROM workflow_template_catalog WHERE id = $1`,
        [templateId],
      );
      const row = r.rows[0];
      if (row === undefined) return null;
      return {
        templateId: row.id,
        name: row.name,
        sourceVersion: row.source_version,
        segments: row.segments,
        matrix: row.matrix,
      };
    });
  }

  forOrg(orgId: OrgId): WorkflowTemplateCatalogPort {
    return { load: (templateId) => this.load(orgId, templateId) };
  }
}

/**
 * `OrgTemplateCreatePort` 的唯一写点。⚠ 与上面两个类不同：这个端口的 `create` 入参
 * **本来就带 `orgId`**（`workflow-orchestration-ports.ts` 接口定义），所以这个类可以
 * 直接 `implements OrgTemplateCreatePort` 并作为单例注入 DI，不需要 `forOrg()` 现场绑定。
 *
 * `sourceVersion` 固定写 1：`OrgTemplateCreatePort.create` 的入参没有携带来源版本号
 * （`save-as-org-template.ts` 只传 `orgId`/`name`/`segments`/`matrix`），而这里新建的是
 * 一个**独立的**工作流模板目录项——它自己的第一个版本，1 是对「刚创建」最不勉强的读法，
 * 不是从来源模板搬运来的版本号（O-02：两层结构下二者本来就是两件事，源版本号只活在
 * 来源项目的编排快照里，不随「另存为」传递）。
 */
export class PgOrgTemplateCreateRepository implements OrgTemplateCreatePort {
  constructor(
    private readonly db: DatabasePort,
    private readonly ids: IdFactory,
  ) {}

  async create(input: {
    readonly orgId: string;
    readonly name: string;
    readonly segments: readonly AgendaSegmentRefLike[];
    readonly matrix: readonly MatrixCellLike[];
  }): Promise<{ readonly workflowTemplateId: string }> {
    // `wft` 前缀（workflow template）；由仓库既有的 `IdFactory` 生成，不是调用方传入的
    // 任何既有 id——这是「新 id ≠ 任何已存在的来源 id」（I-17 不回写）在数据库层的真正落点，
    // 用例层的相等性断言只是复核，不是这条不变量唯一的守卫（见该用例文件头注）。
    const workflowTemplateId = this.ids.next("wft");
    const orgId = toOrgId(input.orgId);
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO workflow_template_catalog (id, org_id, name, source_version, segments, matrix)
         VALUES ($1, $2, $3, 1, $4::jsonb, $5::jsonb)`,
        [workflowTemplateId, orgId, input.name, JSON.stringify(input.segments), JSON.stringify(input.matrix)],
      );
    });
    return { workflowTemplateId };
  }
}
