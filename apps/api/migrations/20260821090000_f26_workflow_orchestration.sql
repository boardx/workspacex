-- F26 gap-fill（#1680）：`saveAsOrgTemplate` / `switchWorkflowTemplate` / `getWorkflowOrchestration`
-- 三个 application 用例首次接上真实 Postgres。契约束已签核（`design-signoff.md` status:
-- confirmed，covers 含 F26）——本迁移零新增设计面，只是给已签核的端口一个存储实现。
--
-- ## 两张表，对应端口文件头注的两个概念
--
-- `application/templates/workflow-orchestration-ports.ts`：
--   `OrchestrationRepository`  —— 项目侧「此刻套用了哪个模板 + 环节链 + 矩阵」的**实例**快照。
--   `WorkflowTemplateCatalogPort` / `OrgTemplateCreatePort` —— 后台工作流模板库的一条目录项，
--     与项目实例是两张不同的表（O-02：两层结构，模板 → 实例单向写入，互不改写，I-17）。
--
-- ## `segments`/`matrix` 为什么是 JSONB 而不是各自拆行
--
-- 与 `blueprint_design_facets` 单开一表拆行的理由**不对称**：那张表的分子要用
-- `count(*)` 在 SQL 侧聚合，是真实的读放大关切。这里的 `segments`/`matrix` 从不需要
-- SQL 侧聚合或按单项过滤——`getWorkflowOrchestration`/`switchWorkflowTemplate` 读写的
-- 永远是整份环节链或整份矩阵（`upsertCell` 除外，见下），拆行只会把「一次读出一份快照」
-- 变成「N 次 JOIN 拼回一份快照」，是没有收益的复杂度。
--
-- ## `project_workflow_orchestration.revision` 的并发语义 —— 与 `upsertCell` 强相关，
--   与 `replace`（换模板）**无关**
--
-- 见端口文件头注：`replace()` 是整份覆盖式保存，换模板本身不做单格粒度的乐观并发比对；
-- `upsertCell()`（矩阵格编辑，F27 消费）才是 `revision` 真正的 CAS 令牌——
-- `SELECT ... FOR UPDATE` 读快照、应用层比对 `revision`，不用
-- `UPDATE ... WHERE revision = $expected`（那种写法分不清「项目还没套模板」与
-- 「版本不对」两种 0 行结果，同 `pg-blueprint-repository.ts` `updateDesignFacet` 的既有纪律）。

CREATE TABLE IF NOT EXISTS project_workflow_orchestration (
  -- 1:1 于项目：一个项目此刻只有一份编排实例。
  project_id              text PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  -- ⚠ 冗余列，非查询便利：RLS 策略只看得见本表的列，见文件头「本仓已因漏写 JOIN 漂移」纪律。
  org_id                  text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  template_id             text NOT NULL,
  template_name           text NOT NULL,
  template_source_version integer NOT NULL CHECK (template_source_version > 0),
  -- AgendaSegmentRefLike[]：{agendaSegmentId,title,addedBy,optional}
  segments                jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- MatrixCellLike[]：{cellId,agendaSegmentId,roleKey,content,canvasTemplateId,skillIds}
  matrix                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 乐观并发令牌，专属 `upsertCell`（见文件头注）。`replace` 每次都写一个新值，
  -- 但不比对旧值——它是「下一次 upsertCell 该拿什么当 expectedRevision」的起点。
  revision                text NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- 后台工作流模板库：`saveAsOrgTemplate` 的唯一写点（`OrgTemplateCreatePort.create`），
-- `switchWorkflowTemplate` 的唯一读点（`WorkflowTemplateCatalogPort.load`）。
-- ⚠ 没有从 `project_workflow_orchestration` 指过来的外键——O-02/I-17 两层结构里，
--   项目实例与后台模板只通过快照版本号关联，不是行级引用（模板可以被后续另存覆盖版本号
--   而不影响已经套用过它的项目实例，这条独立性正是「互不改写」的存储表达）。
CREATE TABLE IF NOT EXISTS workflow_template_catalog (
  id             text PRIMARY KEY,
  org_id         text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (length(btrim(name)) > 0),
  source_version integer NOT NULL CHECK (source_version > 0),
  segments       jsonb NOT NULL DEFAULT '[]'::jsonb,
  matrix         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_template_catalog_org_idx ON workflow_template_catalog (org_id);

-- ## 租户隔离：RLS，同 `blueprints` 迁移的既有纪律 —— 应用层的 WHERE org_id 是性能过滤，
-- 不是安全边界；边界在这里，漏写租户上下文的查询读到零行而不是别人的数据。
ALTER TABLE project_workflow_orchestration ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_workflow_orchestration FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_template_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_template_catalog FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_workflow_orchestration_tenant ON project_workflow_orchestration;
CREATE POLICY project_workflow_orchestration_tenant ON project_workflow_orchestration
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

DROP POLICY IF EXISTS workflow_template_catalog_tenant ON workflow_template_catalog;
CREATE POLICY workflow_template_catalog_tenant ON workflow_template_catalog
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON project_workflow_orchestration, workflow_template_catalog FROM app_rw;
-- 两张表都需要 UPDATE（`replace`/`upsertCell` 都是覆盖式写同一行，不是「删了重插」——
-- 同 `project_topics`/`project_grouping_revision`（F950）的既有纪律：并发版本号靠
-- `UPDATE ... RETURNING`，不是先删后插）。都不给 DELETE：项目编排随项目级联删除
-- （FK ON DELETE CASCADE），模板库退役属未裁决的另一条能力，不在本 gap-fill 范围内。
GRANT SELECT, INSERT, UPDATE ON project_workflow_orchestration TO app_rw;
GRANT SELECT, INSERT, UPDATE ON workflow_template_catalog TO app_rw;

-- 组织冻结/项目归档策略只看得见它运行时已经存在的表，建完新租户表要重新应用一次
-- （F22/F124 的 COMMENT 都点名过这一步，F46/#342 都因漏调栽过）。
SELECT kernel_apply_org_freeze_policies();
SELECT kernel_apply_project_archive_policies();
