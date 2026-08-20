-- F29 补实现（issue #1667）：`templates.submitBlueprintChangeRequest` 首次接上电——
-- 待审改动记录表。契约 `templates.ChangeRequest` 四要素 + 生命周期状态
-- （`domain/templates/pending-change.ts` 的 `PendingChangeRecord`）。
--
-- ⚠ 本表只被两类调用点写：`submitBlueprintChangeRequest`（INSERT，`status='pending'`）与
--   未来的 `mergePendingChange`/`rejectPendingChange`（UPDATE `status`，本迁移不实现那两个
--   controller，不在本 feature 范围——`listPendingChanges`/`mergePendingChange` 契约仍
--   零 controller，如实登记，不在这里假装实现）。
--
-- ⚠ 「提交 ≠ 生效」（I-10）在这张表的形状上：**没有任何一列能触及 blueprints /
--   blueprint_versions**——`blueprint_id`/`base_version_id` 只是**指向**它们的引用列，
--   不是外键级联写入的入口；本表没有 trigger、没有 FK ON UPDATE CASCADE 之类会让
--   「写这张表」顺带改到蓝本本体的机关。

CREATE TABLE IF NOT EXISTS blueprint_pending_changes (
  id                text PRIMARY KEY,
  org_id            text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  blueprint_id      text NOT NULL REFERENCES blueprints (id) ON DELETE CASCADE,
  design_facet_key  text NOT NULL,
  before_value      text NOT NULL,
  after_value       text NOT NULL,
  source_project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  proposed_by       text NOT NULL,
  proposed_at       timestamptz NOT NULL,
  -- ⚠ 理由必填（R7「没有『为什么』的偏离不允许提交」）——CHECK 钉在 DB 层，
  --   不只靠应用层 `assertRationalesPresent`（同本仓「关键不变量落两层」的一贯做法）。
  rationale         text NOT NULL CHECK (length(btrim(rationale)) > 0),
  base_version_id   text NOT NULL REFERENCES blueprint_versions (id),
  -- 契约闭集三值：pending（待审）/ merged（已合并）/ rejected（已拒绝）。
  status            text NOT NULL DEFAULT 'pending'
    CONSTRAINT blueprint_pending_changes_status_check CHECK (status IN ('pending', 'merged', 'rejected')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blueprint_pending_changes_blueprint_idx
  ON blueprint_pending_changes (blueprint_id, design_facet_key, status);

ALTER TABLE blueprint_pending_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE blueprint_pending_changes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS blueprint_pending_changes_tenant ON blueprint_pending_changes;
CREATE POLICY blueprint_pending_changes_tenant ON blueprint_pending_changes
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON blueprint_pending_changes FROM app_rw;
-- 只 SELECT + INSERT：本迁移配套的 controller 只实现「提交」这一半（`create`）。
-- merge/reject 是另一 feature 的写路径（尚无 controller），不预先授它用不上的 UPDATE。
GRANT SELECT, INSERT ON blueprint_pending_changes TO app_rw;

SELECT kernel_apply_org_freeze_policies();

COMMENT ON TABLE blueprint_pending_changes IS
  'F29（#1667）: submitBlueprintChangeRequest 的待审改动记录。提交≠生效（I-10）——'
  '本表没有任何一列/触发器能触及 blueprints 或 blueprint_versions 本体。';
