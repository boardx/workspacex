-- 2026-09-08 人类指令 —— 运营收件箱「卡片上能打标签、界面上方能按标签筛」。
--
-- 契约 `packages/contracts/src/inbox.ts` 新增 `InboxItem.tags`（三类统一）与
-- `operations.setInboxItemTags`（只对 feedback / design）。这张表是**反馈与设计方案**
-- 标签的唯一落库处；系统异常的标签仍住在 `error_logs.tags`（迁移
-- `20260903120000_error_logs_lifecycle_tags.sql`），本表**不存** `kind = 'exception'`
-- ——同一事实不得声明在两处，CHECK 约束把这条纪律落到 DB 层。
--
-- ## 为什么是侧表，不是给 `product_feedback` / `design_projects` 各加一列
--
-- 同 `20260906120000_inbox_board_order.sql` 头注：标签是收件箱这张投影上的运营属性，
-- 不是反馈 / 方案本身的领域字段；一张 `(org_id, kind, item_id)` 寻址的侧表让两张源表
-- 一行都不用碰，也让"以后要给第四种来源打标签"不用再开迁移。
CREATE TABLE IF NOT EXISTS inbox_item_tags (
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- ⚠ 没有 'exception'：系统异常的标签在 `error_logs.tags`（见文件头）。
  kind        text NOT NULL CHECK (kind IN ('feedback', 'design')),
  item_id     text NOT NULL,
  tags        text[] NOT NULL DEFAULT '{}'::text[],
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind, item_id)
);

CREATE INDEX IF NOT EXISTS inbox_item_tags_org_idx ON inbox_item_tags (org_id);
CREATE INDEX IF NOT EXISTS inbox_item_tags_tags_idx ON inbox_item_tags USING GIN (tags);

ALTER TABLE inbox_item_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_item_tags FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inbox_item_tags_tenant ON inbox_item_tags;
CREATE POLICY inbox_item_tags_tenant ON inbox_item_tags
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE ON inbox_item_tags TO app_rw;

SELECT kernel_apply_org_freeze_policies();
