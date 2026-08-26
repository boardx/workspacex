-- 平台画布模板库 —— 人类 2026-08-26 裁决：「我们新建的模板是给所有的组织使用的，
-- 并不是给某一个组织使用」，形态选定 **B2：全局母版 + 用时 fork**。
--
-- ## 为什么是 B2 而不是"库里一份大家共享"（B1）
--
-- `canvas_template_bindings` 对模板的引用是**复合外键**，引用列**含 org_id**：
--
--     FOREIGN KEY (org_id, template_key, template_version)
--       REFERENCES canvas_templates (org_id, key, version)
--
-- 绑定行的 `org_id` 是**使用这个模板的那个真实组织**。若模板行搬到平台组织下，两边的
-- `org_id` 不相等，这条外键就指不到目标行 ⇒ **绑定根本插不进去**。B1 因此必须把 org_id
-- 从这条外键里拆掉，等于把「绑定指向一个真实存在的模板版本」从数据库保证降级成应用层
-- 承诺——本仓最不愿意做的那类降级。
--
-- B2 下绑定永远指向 fork 出来的**组织自有行**，这条外键**一个字都不用改**。
--
-- ## 这份迁移只做"看得见"，不做"改得动"
--
-- 放宽的**只有 SELECT**：新增一条独立的 permissive 策略让所有组织读得到平台母版。
-- INSERT / UPDATE / DELETE 的既有严格策略**原封不动** ⇒ 组织改不了母版，是策略层面
-- 的事实，不是应用层的一句 if。fork（把母版复制成自己的一份）走真实用例，不在这里。
--
-- ⚠ 多条 permissive 策略之间是 **OR**。所以这里只加一条 `FOR SELECT`，不去动原来那条
--   `FOR ALL`——后者继续管着写路径。改写原策略、把 OR 塞进它的 USING 也能达到同样的读
--   效果，但那会同时放宽 UPDATE 的行可见性（UPDATE 的 USING 与 SELECT 可见性在实现上
--   纠缠，见 0014 冻结策略里同一处的注释），风险大于收益。
--
-- ## 与 uc-0-5 AC1 / R12 V1 的关系（🟡 design-delta，待人类补签）
--
-- V1 要求「把某组织的清单清空后，该组织成员看到的可用能力为零、界面进入空态而不是显示
-- 默认值」。平台母版对所有组织可见，清空后仍会看到 19 个——字面上与 V1 冲突。
--
-- 我的解释：V1 禁的是**隐式兜底**（一个看不见的默认值冒充组织配置），而 A4 明确支持
-- 「组织配置支持**从模板初始化**（新建组织时给一套推荐清单），但那只是初始值，不是不可改
-- 的默认」。因此界面必须把两者**明确分区**：「我的模板」= 组织自有行，清空后**真的为空**，
-- V1 的断言在这一区仍然成立；「平台推荐」= 母版，显式标注、只读、点「加入我的组织」才 fork。
--
-- ⚠ 这是**我的解释**，不是既成事实。status 只由人类在束级 `design-signoff.md` 里改。
--
-- 可独立重放：全程 IF NOT EXISTS / DROP-then-CREATE / ON CONFLICT DO NOTHING。

-- ── ① `kind` 开第三档 ────────────────────────────────────────────────────────────
--
-- ⚠ 老老实实加一档，而不是塞一行 `kind='organization'` 的假组织。0003 的注释逐字写着
--   「kind is a FIRST-CLASS field, not a special case branch」——一个伪装成普通组织的
--   平台行，会让每一处「遍历所有组织」的代码都把它当成真组织算进去（成员数、计费、
--   组织列表、冻结策略……），而那些地方一个都不会报错。
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_kind_known;
ALTER TABLE organizations ADD CONSTRAINT organizations_kind_known
  CHECK (kind IN ('organization', 'personal-local', 'platform'));

-- 0003 建表时的内联 CHECK 与上面这条同名不同源，重放时要把老的那条也让开。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'organizations'::regclass AND conname = 'organizations_kind_check'
  ) THEN
    ALTER TABLE organizations DROP CONSTRAINT organizations_kind_check;
  END IF;
END $$;

-- ── ② 平台组织本体：**这里没有 INSERT** ─────────────────────────────────────────
--
-- 2026-08-26 实测事故：本节原先在这里直接 `INSERT INTO organizations` +
-- `INSERT INTO org_memberships`，把 `org-platform` 无条件种进**每一个跑过这份迁移
-- 的数据库**——包括每一次测试用的隔离库。后果不是"多了一行没人用的数据"：
-- `backfill-default-agents.ts`/`backfill-deep-research-agent.ts`/
-- `backfill-image-gen-agent.ts` 三个脚本都是 `FROM organizations o`（**不限定哪个
-- 组织**）+ `WHERE ... org_role = 'admin'` 找"有 admin 的组织"逐个种默认 agent——
-- 一个新迁移出来的库，从此**永远**多一个"有 admin 的组织"（org-platform 自己），
-- 于是这三个脚本各自的单测断言（"这个库里该有 1 个符合条件的组织"）全部变成 2，
-- 三个 shard 一起红。这与 `20260805030000_canvas_template_registry.sql` 文件头
-- 那条纪律是同一件事——本仓已经为了同一个理由不在迁移里 seed 内置模板，这里
-- 犯了一次一模一样的错。
--
-- 平台组织本体与它的服务身份（成员行、无凭据行，结构上不可登录，理由见旧版本
-- 该节注释）现在由 `apps/api/scripts/backfill-platform-org.ts` 显式创建——
-- 与 `backfill-canvas-builtin-templates.ts` 同一条纪律：**不自动跑给每个环境**，
-- 只在真人明确要求平台模板库上线时手动跑一次。

-- 恰好一个平台组织。索引留在这里（schema 约束），种数据的时机移到上面那个脚本。
CREATE UNIQUE INDEX IF NOT EXISTS organizations_single_platform
  ON organizations ((kind)) WHERE kind = 'platform';

-- ── ③ 只放宽读 ──────────────────────────────────────────────────────────────────
--
-- 与既有的 `canvas_templates_tenant`（FOR ALL，管写）并存，两条 permissive 策略 OR 起来：
-- SELECT 看得到「本组织的行 ∪ 平台母版」，写路径仍然只有本组织自己的行。
DROP POLICY IF EXISTS canvas_templates_platform_read ON canvas_templates;
CREATE POLICY canvas_templates_platform_read ON canvas_templates
  FOR SELECT
  USING (org_id = 'org-platform');

COMMENT ON POLICY canvas_templates_platform_read ON canvas_templates IS
  'B2 全局母版：所有组织都读得到平台库的行。只有 SELECT——写路径由 canvas_templates_tenant '
  '继续严格按 app.current_org 管，所以"组织改不了母版"是策略层面的事实，不是应用层的 if。';

-- ⚠ `canvas_template_bindings` 的策略**不动**。绑定永远指向 fork 出来的组织自有行，
--   平台母版不可被直接绑定——这正是 B2 相对 B1 的全部价值（外键不用拆）。

-- F22：冻结策略按 pg_catalog 找租户表安装，本迁移没加表，但重放一次无害且与既有约定一致。
SELECT kernel_apply_org_freeze_policies();
