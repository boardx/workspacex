-- F178 (BP-04)：发布版本 —— `blueprint_versions`（不可变快照）+ `blueprint_bindings`
-- （试跑/套用绑定，发布门槛的「已试跑」判据挂在这张表上）
-- 契约：templates.startTrialRun / templates.publishBlueprintVersion（束已签核 2026-07-30，
-- covers 含 F178）
--
-- ## 为什么这两张表必须一起建
--
-- `evaluateTrialRunGate`（domain/templates/trial-run-gate.ts）判「已试跑」的依据是
-- 「这个蓝本有没有至少一条 kind='trial-run' 的绑定」——不是一个独立布尔标记。
-- 没有 blueprint_bindings 表，`publishBlueprintVersion` 的试跑门槛就没有任何真实数据
-- 可判，要么假装通过（静默降级，本仓明令禁止的做法），要么永远拒绝（发布形同虚设）。
-- 两者都不诚实，所以 F178 把 startTrialRun 与 publishBlueprintVersion 的存储一起接上电。
--
-- ## blueprint_bindings 现在只会出现 kind='trial-run' 的行
--
-- kind='project' 是「蓝本被正式套用建了一个项目」——那要等 BP-08
-- （createProject 带 blueprintVersionId）才会产生。表结构现在就把两种 kind 都放进
-- CHECK 约束（契约 `BlueprintBinding.kind` 本就是这两值的闭集），不是预留占位，
-- 是把闭集如实落成 DDL；只是本迁移配套的应用代码只写 trial-run 这一种。
--
-- ## blueprint_versions.content 为什么是 jsonb 而不是复用 blueprint_design_facets
--
-- 版本是**冻结快照**（I-2：写入后不再改）。blueprint_design_facets 是**当前可编辑状态**，
-- 会被后续 updateDesignFacet 继续改动。若版本直接引用 design_facets 的行，
-- 快照会跟着草稿的后续编辑一起漂移——那就不是「不可变」了。因此发布时把当前内容
-- 复制一份冻结进 jsonb 列，此后 design_facets 表怎么改都不影响已发布版本的内容。

CREATE TABLE IF NOT EXISTS blueprint_versions (
  id                        text PRIMARY KEY,
  blueprint_id              text NOT NULL REFERENCES blueprints (id) ON DELETE CASCADE,
  org_id                    text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  version_number            integer NOT NULL CHECK (version_number > 0),
  -- 冻结快照：发布那一刻的设计环节取值。⚠ 不加外键到 blueprint_design_facets——
  --   那张表的行此后会继续变，版本快照必须与它脱钩。
  content                   jsonb NOT NULL,
  changed_design_facet_keys text[] NOT NULL DEFAULT '{}',
  -- 契约 BlueprintVersionState 两值闭集（不含 draft——草稿不是一个版本）
  state                     text NOT NULL CHECK (state IN ('published', 'archived')),
  -- O-18②：回滚产生的新版本记它从哪一版回来；非回滚为 NULL。
  --   不建外键约束到自身 id——回滚源版本可能已被后续清理策略处理，
  --   「这条记录曾经从哪来」这条沿革事实不该因为源记录状态变化而无法插入新行。
  rolled_back_from          text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  -- I-3：一个蓝本内版本号单调递增、不复用、不缺号——数据库层面钉一次，不只靠应用层
  UNIQUE (blueprint_id, version_number)
);

CREATE INDEX IF NOT EXISTS blueprint_versions_blueprint_idx ON blueprint_versions (blueprint_id, version_number DESC);

CREATE TABLE IF NOT EXISTS blueprint_bindings (
  id            text PRIMARY KEY,
  blueprint_id  text NOT NULL REFERENCES blueprints (id) ON DELETE CASCADE,
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 契约 BlueprintBinding.kind 两值闭集：'project' 待 BP-08 才会产生行，见文件头注
  kind          text NOT NULL CHECK (kind IN ('project', 'trial-run')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blueprint_bindings_blueprint_kind_idx ON blueprint_bindings (blueprint_id, kind);

-- 租户隔离：RLS，同 BP-01/BP-02 迁移的理由（应用层 WHERE org_id 是性能过滤不是安全边界）
ALTER TABLE blueprint_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE blueprint_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE blueprint_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE blueprint_bindings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS blueprint_versions_tenant ON blueprint_versions;
CREATE POLICY blueprint_versions_tenant ON blueprint_versions
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

DROP POLICY IF EXISTS blueprint_bindings_tenant ON blueprint_bindings;
CREATE POLICY blueprint_bindings_tenant ON blueprint_bindings
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON blueprint_versions, blueprint_bindings FROM app_rw;
-- blueprint_versions：SELECT + INSERT（新版本）+ UPDATE（旧版 published → archived，
--   同一发布事务里的第二个写点，见 domain/templates/publish-blueprint-version.ts 头注
--   「同事务」）。不给 DELETE——版本不可变（I-2），删版本是另一条裁决，今天没有实现它。
GRANT SELECT, INSERT, UPDATE ON blueprint_versions TO app_rw;
-- blueprint_bindings：只需 SELECT + INSERT。绑定是历史事实的记录（曾经试跑过/套用过），
--   不给 UPDATE/DELETE——修改或删除一条绑定记录等于让「已经发生过的事」重新变得没发生过。
GRANT SELECT, INSERT ON blueprint_bindings TO app_rw;

SELECT kernel_apply_org_freeze_policies();
