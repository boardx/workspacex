-- design-delta `platform-owned-skills` —— 四个官方 skill（pptx-create/docx-create/
-- xlsx-create/pdf-create）对所有 org 默认可见/可挂载，不需要逐个 org 导入。
--
-- ## 直接复用 canvas 模板已经上线的 platform-org 模式
--
-- `PLATFORM_ORG_ID`/`org-platform`（`20260826120000_platform_canvas_template_
-- library.sql`）已经是一个真实存在的服务组织（`kind = 'platform'`）。这里只是把
-- 同一套"额外一条 FOR SELECT 策略，与既有 FOR ALL 租户策略并存"的机制，套到四张
-- skill 相关表上——不重新发明，不新增 `organizations.kind` 枚举值。
--
-- ## 与 canvas 模板的一处关键差异：不需要"用时 fork"
--
-- canvas 模板选 B2（全局母版 + 用时 fork）是因为 `canvas_template_bindings` 对模板的
-- 引用是复合外键（含 org_id），母版行与绑定行的 org_id 不相等就没法建立外键。
-- skill 没有这个约束：`thread_skill_mounts_skill_fk` 已经在 #1534 被整个 DROP 掉
-- （见 `20260818090000_i1534_thread_skill_mounts_wave2_fk.sql`），referential
-- integrity 现在完全在应用层（`SkillVisibilityPort.visibleTo()`）。所以这里
-- **不需要** fork 机制——平台行可以被组织直接挂载/执行，`thread_skill_mounts`/
-- `agent_versions.skill_version_ids` 里的 `skill_id`/`version_id` 直接指向
-- `org-platform` 下的真实行即可。
--
-- ## 只放宽读，不放宽写（同 canvas 模板同一条纪律）
--
-- 新增的四条策略全部是 `FOR SELECT`，与既有的 `_tenant`（`FOR ALL`）策略并存
-- （Postgres 对多条 permissive 策略取 OR）。任何组织依然改不了、删不了平台行——
-- 这是策略层面的事实，不是应用层的一句 if。
--
-- 可独立重放：全程 DROP-then-CREATE，无副作用。这份迁移**不 INSERT 任何数据**——
-- 四个 skill 的实际内容由 `apps/api/scripts/backfill-platform-skills.ts` 显式创建，
-- 人工触发，同 `backfill-platform-org.ts`/`backfill-canvas-builtin-templates.ts` 先例，
-- 避免 `20260826120000_platform_canvas_template_library.sql` 头注记录过的那次真实
-- 事故（迁移里直接 seed 数据，导致每一个跑过这份迁移的库——包括每次测试隔离库——
-- 都无条件多出几行，让"这个库里该有 N 行"这类断言全部漂移）。

DROP POLICY IF EXISTS skills_platform_read ON skills;
CREATE POLICY skills_platform_read ON skills
  FOR SELECT
  USING (org_id = 'org-platform');

COMMENT ON POLICY skills_platform_read ON skills IS
  '四个官方 skill 对所有组织可见（design-delta platform-owned-skills）。只读——写路径 '
  '由 skills_tenant 继续严格按 app.current_org 管。';

DROP POLICY IF EXISTS skill_versions_platform_read ON skill_versions;
CREATE POLICY skill_versions_platform_read ON skill_versions
  FOR SELECT
  USING (org_id = 'org-platform');

COMMENT ON POLICY skill_versions_platform_read ON skill_versions IS
  '同 skills_platform_read，四个官方 skill 的版本行对所有组织可见，只读。';

DROP POLICY IF EXISTS skill_version_files_platform_read ON skill_version_files;
CREATE POLICY skill_version_files_platform_read ON skill_version_files
  FOR SELECT
  USING (org_id = 'org-platform');

COMMENT ON POLICY skill_version_files_platform_read ON skill_version_files IS
  '同 skills_platform_read——这一条是最关键的一条：readPinnedSkills() 真正取 '
  'SKILL.md 正文走的就是这张表，漏了它会让"能看到、能挂上，但一执行就 '
  'SKILL_VERSION_UNAVAILABLE"（design-delta contract.md §4③ 特意点名的坑）。';

DROP POLICY IF EXISTS capability_listings_platform_read ON capability_listings;
CREATE POLICY capability_listings_platform_read ON capability_listings
  FOR SELECT
  USING (org_id = 'org-platform');

COMMENT ON POLICY capability_listings_platform_read ON capability_listings IS
  '同 skills_platform_read——这一条是 GET /capabilities?kind=skill（chat `#` 挂载 '
  '候选面板、后台 skill 目录列表）的读路径，四个官方 skill 要出现在候选里就靠它。';

-- F22：冻结策略按 pg_catalog 找租户表安装，本迁移没加表，但重放一次无害且与既有约定一致。
SELECT kernel_apply_org_freeze_policies();
