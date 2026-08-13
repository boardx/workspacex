-- F173 (BP-01)：蓝本落库 —— `blueprints` 表 + 设计环节取值表
-- 契约：templates.createBlueprint / listBlueprints（束已签核 2026-07-30，covers 含 F173）
--
-- ## 这个文件在防什么
--
-- 蓝本这条线此前是「契约 34 个 operation + 32 个纯用例，零表零仓储零路由」——
-- 应用层写得很完整，但一个都接不上电（#991 勘探结论）。本迁移是那条链的第一块地基。
--
-- ## 为什么设计环节的取值单开一张表，而不是 blueprints 上一列 JSONB
--
-- 完成度（`Completeness`）的**分母**是「定义表中已定义的项数」，由运行时读
-- `domain/templates/design-facet-table.ts` 得出（F17 行为契约逐字：**禁止硬编码 16 或 15**）。
-- 分子则是「这个蓝本已填了几项」。
--
-- 若把取值塞进一列 JSONB：
--   · 分子要在应用层解析 JSON 数一遍，SQL 侧无法聚合 ⇒ 列表页 N 个蓝本要取 N 份完整 JSON；
--   · 「哪些 key 合法」失去数据库层的约束，定义表改名时旧 key 会静默残留。
-- 一行一取值则分子就是一条 `count(*)`，且 key 有 `NOT NULL` 约束、可加索引。
--
-- ⚠ **不在本表上做 key 的白名单 CHECK**：合法 key 的唯一事实源是那张 TS 定义表
--   （`design-facet-table.ts`），在 SQL 里再写一份枚举就是「同一事实两处声明」——
--   本仓已因此漂移五次。校验放在应用层，对着定义表做。
--
-- ## versionNumber 为什么在本表而不是版本表
--
-- 本迁移**不建版本表**（那是 BP-04 发布版本的事）。`version_number` 先作为一列存在，
-- 语义是「已发布过几个版本」，草稿期恒为 0 —— 契约 `BlueprintRow.versionNumber` 是
-- `nonnegative` 而非 `positive`，0 是合法值，正对应「还没发布过」。
-- BP-04 建版本表时，这一列改为由版本表派生（届时迁移里写清）。

CREATE TABLE IF NOT EXISTS blueprints (
  id              text PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(btrim(name)) > 0),
  -- 契约 BlueprintState 三取值闭集
  state           text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'archived')),
  -- 契约 BlueprintOrigin 三取值闭集。⚠ 本版只落库 blank / copy 两种；
  --   reverse-from-project 在控制器层被拒（依赖未接入的 AI 抽取），永远到不了这里，
  --   但枚举保留三值——契约是三值，DDL 收窄会让将来接上 AI 时还要改一次表。
  origin          text NOT NULL CHECK (origin IN ('blank', 'copy', 'reverse-from-project')),
  -- copy 时是源蓝本 id；blank 时 NULL。⚠ 不加外键：源蓝本被删后，
  --   「这个蓝本是复制来的」这条事实不该跟着消失（沿革信息 > 引用完整性）。
  source_id       text,
  -- 契约 DurationTier 五取值闭集；新建时未选档位 ⇒ custom（契约无 null 档位）
  duration_tier   text NOT NULL DEFAULT 'custom'
                    CHECK (duration_tier IN ('half-day', 'one-day', 'two-day', 'three-day', 'custom')),
  -- 已发布版本数；草稿期恒 0（见文件头注）
  version_number  integer NOT NULL DEFAULT 0 CHECK (version_number >= 0),
  -- 是否机器生成：契约要求「恒 true 当且仅当 origin = reverse-from-project」，
  -- 即 AI 产出必须被标识。本版 reverse 未接入 ⇒ 恒 false，但列先在。
  machine_generated boolean NOT NULL DEFAULT false,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 列表页按组织取，且常按状态过滤（listBlueprints.in 有 state）
CREATE INDEX IF NOT EXISTS blueprints_org_state_idx ON blueprints (org_id, state);

-- 设计环节取值：一行一项。key 的合法性由应用层对着定义表校验（见文件头注）
--
-- ⚠ 本表带 `org_id` 冗余列，且它**不是**为了查询方便：RLS 策略要按租户过滤，
--   而策略只能看本表的列。没有它就只能靠 JOIN blueprints 去判租户，
--   那等于把隔离交给每一条 SQL 自己记得写 JOIN —— 忘写的那一条不会有任何东西报警。
CREATE TABLE IF NOT EXISTS blueprint_design_facets (
  blueprint_id      text NOT NULL REFERENCES blueprints (id) ON DELETE CASCADE,
  org_id            text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  design_facet_key  text NOT NULL CHECK (length(btrim(design_facet_key)) > 0),
  -- 已填的内容。空串视为未填 —— 由 CHECK 挡住，未填就不该有行
  content           text NOT NULL CHECK (length(btrim(content)) > 0),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blueprint_id, design_facet_key)
);

-- ## 租户隔离：RLS，不是「每条 SQL 自己记得加 WHERE org_id」
--
-- 应用层的 `WHERE b.org_id = $1` 是**性能与语义**上的过滤，不是安全边界：
-- 漏写一次没有任何东西会红。真正的边界在这里——策略挂在表上，
-- 任何忘了带租户上下文的查询读到的是**零行**而不是别人的数据。
ALTER TABLE blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE blueprints FORCE ROW LEVEL SECURITY;
ALTER TABLE blueprint_design_facets ENABLE ROW LEVEL SECURITY;
ALTER TABLE blueprint_design_facets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS blueprints_tenant ON blueprints;
CREATE POLICY blueprints_tenant ON blueprints
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

DROP POLICY IF EXISTS blueprint_design_facets_tenant ON blueprint_design_facets;
CREATE POLICY blueprint_design_facets_tenant ON blueprint_design_facets
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON blueprints, blueprint_design_facets FROM app_rw;
-- ⚠ **没有 DELETE**：蓝本的退役语义是归档（契约 `BlueprintState` 含 archived），
--   授予 DELETE 会让「把归档实现成删掉一行」这个最省事的错误实现变得**可能**——
--   canvas 模板那张表出于同一理由也没给（该迁移第 126 行），research 模块 F146 真栽过。
--   契约里那条 `deleteBlueprint`（DELETE /blueprints/:id）是**硬删**，属另一条裁决
--   （「未被任何项目套用过的草稿才可删」），等实现它时再单独加权限并写清判据。
GRANT SELECT, INSERT, UPDATE ON blueprints TO app_rw;
GRANT SELECT, INSERT, UPDATE ON blueprint_design_facets TO app_rw;

-- 组织冻结策略只看得见它运行时已经存在的表。加完租户表要重新应用一次，
-- 否则一个被停用的组织仍然能新建蓝本。
SELECT kernel_apply_org_freeze_policies();
