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

-- ── ② 平台组织本体 ──────────────────────────────────────────────────────────────
--
-- 唯一的一行，id 写死。`owner_user_id` 必须为 NULL（`organizations_owner_iff_personal_local`
-- 要求 owner 有且仅有 personal-local 才有），`model_policy='any'`（那条 CHECK 只约束
-- personal-local）。它**没有任何成员**——没有人"属于"平台，也不该有人能以它的身份登录。
INSERT INTO organizations (id, name, kind, status, model_policy)
VALUES ('org-platform', '平台模板库', 'platform', 'active', 'any')
ON CONFLICT (id) DO NOTHING;

-- 恰好一个平台组织。第二行会让「哪一个是母版库」变成一个要靠约定回答的问题。
CREATE UNIQUE INDEX IF NOT EXISTS organizations_single_platform
  ON organizations ((kind)) WHERE kind = 'platform';

-- ── ②b 维护母版的那个身份：有成员行、**无凭据行** ────────────────────────────────
--
-- 上面写着「它没有任何成员」——那句话说早了。母版要能被写，而**所有**写路径都过
-- `requireTemplateAdmin`（org admin 成员身份）。没有成员 ⇒ 平台库永远是空的，
-- 或者只能靠裸 INSERT 绕开鉴权/占用判定/发布校验，而那正是回填脚本刻意不做的事。
--
-- 所以给它**恰好一个** admin 成员。它不是一个人：
--
-- ⚠ `org_memberships.user_id` **没有外键**指向任何用户表，而登录凭据在另一张表
--   `auth_credentials`（`password_hash NOT NULL`，见 0010）。因此一个只有成员行、
--   **没有凭据行**的 user_id 在结构上**无法登录**——不是"我们不给它设密码"这种约定，
--   是登录路径根本查不到它。这就是服务身份的干净形态。
--
-- ⚠ 谁能加它进来：只有这份迁移。产品里没有任何路径能给 platform 组织加成员
--   （加成员走组织后台，而 platform 组织不出现在任何人的组织列表里——它 kind 不是
--   'organization'）。
INSERT INTO org_memberships (user_id, org_id, org_role, team_id)
VALUES ('svc-platform-templates', 'org-platform', 'admin', NULL)
ON CONFLICT (user_id, org_id) DO NOTHING;

COMMENT ON TABLE org_memberships IS
  '组织成员。⚠ 含一行服务身份 svc-platform-templates@org-platform：它维护平台模板母版，'
  '有 admin 成员行但**没有** auth_credentials 行，因此结构上不可登录。'
  '见 20260826120000_platform_canvas_template_library.sql 第 ②b 节。';

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
