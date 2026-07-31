-- 0026 F117: `createProject` 的幂等判据落库
-- (uc-00-1 E5 / V11；契约缺口 packages/contracts/src/project.ts KNOWN_CONTRACT_GAPS.P9)
--
-- ## 这张表是一个**实现判断**，不是一条已签核的裁决
--
-- 契约逐字写着：
--   「uc-00-1 E5/V11 要求幂等，而 `createProject.in` 里没有任何幂等键，
--     `(orgId, name)` 唯一也没有出处 ⇒ 幂等的判据留给实现 + F117 的验收，
--     契约面**不替它编一个键**。」
--
-- 于是 F117 必须自己挑一个判据。三个候选、为什么选第三个：
--
--   A. `UNIQUE (org_id, name)` 加在 `projects` 上
--      —— 不加列，所以不违反 I-P33 的封闭列集；但它把「幂等」偷换成了一条**领域规则**
--      （一个组织里项目重名永远非法）。那条规则**没有出处**，且一旦落库，
--      「两个部门各办一场叫『季度复盘』的工作坊」就永久不可表达。
--   B. 客户端传 `Idempotency-Key` 头
--      —— 工业界标准做法，但它是**新增一个 API 面上的元素**。`createProject.in` 是
--      `.strict()` 的且没有这个字段；在契约之外长出一个请求头，正是 ADR-020 要防的
--      「后端顺手创造出来却无人评审的契约」。
--   C. ⭐ 用**请求本身**算指纹，落一张独立的重放表（本文件）
--      —— E5 的字面意思就是「**同一次创建请求**重复提交」。同一次请求 = 同样的
--      (组织, 发起人, kind, name, 蓝本)。判据完全由已签核的 `createProject.in`
--      加发起人推出，不发明字段、不发明领域规则，且**可整表 DROP 而不动 `projects`**——
--      等 P9 被人类补上真正的幂等键，这张表连同它的判断一起退场，`projects` 不留痕迹。
--
-- ## ⚠ C 的代价，写在这里而不是留给下一个人发现
--
-- **同一个 lead 无法连着建两个 (kind, name, blueprint) 完全相同的容器**：第二次调用
-- 拿到的是第一个容器的 id，`created` 为 false。这不是 bug，是 C 的定义域——
-- 但它**没有出处**，所以它作为「实现挑的判据」报给签核人（见 issue #101 与 PR 正文）。
-- 换一个 lead 建同名容器不受影响（指纹含 actor）。
--
-- ## ⚠ 没有时间窗，是故意的
-- 「重放窗口 60 秒」之类的写法更贴近「防连点」，但那个数字同样无出处，
-- 且会让幂等断言变成一条依赖时钟的断言。无窗口 = 判据是纯函数，测试可断言。
--
-- ## 可重放
-- 全部 IF NOT EXISTS / DROP-then-ADD；migrate:check 忽略版本表强制重放每个文件。

/* ═══════════════ 一、重放表 ═══════════════ */

-- `org_id` 不是冗余：`kernel_tenant_table_audit()` 从 pg_catalog 推导租户表，
-- 没有 org_id 的新表会被判 `UNTENANTED_BUT_GRANTED`，`verify-rls.sh` 当场变红（同 0018）。
--
-- 复合外键 `(project_id, org_id) REFERENCES projects (id, org_id)` 而不是单列外键：
-- 单列只能保证「指向某个存在的容器」，保证不了「指向**本租户的**那个容器」。
-- 不一致时这行会出现在另一个租户的 RLS 视野里，并且一次重放会把**别的组织的**
-- 容器 id 返回给调用者——那是一个真实的跨租户泄漏，而「表在租户审计里判 ok」看不见它。
-- （靶子 `projects_id_org_uniq` 由 0018 建，本文件不重复声明。）
CREATE TABLE IF NOT EXISTS project_creation_requests (
  -- sha256(org_id · actor_id · kind · name · blueprint_version_id)，十六进制。
  -- 主键即幂等：并发下第二路撞 23505，由数据库序列化，**不是先查后写**——
  -- 先查后写在并发下就是那条空转的门（同 `ProjectReason.SEGMENT_ALREADY_ACTIVE` 的理由）。
  fingerprint text PRIMARY KEY,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  actor_id    text NOT NULL,
  project_id  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- ⚠ `DEFERRABLE INITIALLY DEFERRED` 是这张表能当幂等门用的**前提**，不是调优。
  --
  -- 创建事务里的第一条语句必须是「占指纹」（`ON CONFLICT (fingerprint) DO NOTHING`）：
  -- 只有让**数据库**来裁决「这次是新建还是重放」，并发下两路才会被序列化。
  -- 而占指纹的那一刻，它指向的 `projects` 行还没有被插入。
  --
  -- 立即检查的外键会让那条语句当场撞 23503，于是唯一能写出来的顺序变成
  -- 「先建容器 → 再占指纹 → 撞了就回滚重来」——那个形状下**重放也会先建一行容器**，
  -- 靠回滚擦掉。回滚擦得掉行，擦不掉序列号，也擦不掉并发下两路互相等待的时间；
  -- 更要紧的是它把「是不是重放」的判断挪回了应用层的重试循环里。
  FOREIGN KEY (project_id, org_id) REFERENCES projects (id, org_id)
    ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);

COMMENT ON TABLE project_creation_requests IS
  'F117 / uc-00-1 E5: createProject 的重放表。⚠ 这是实现挑的幂等判据，不是已签核的裁决——'
  '契约缺口 KNOWN_CONTRACT_GAPS.P9 说明幂等键无出处。补上真正的幂等键之后，整表可 DROP。';

/* ═══════════════ 二、RLS：入网 ═══════════════ */

ALTER TABLE project_creation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_creation_requests FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_creation_requests_tenant ON project_creation_requests;
CREATE POLICY project_creation_requests_tenant ON project_creation_requests
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON project_creation_requests FROM app_rw;
-- 没有 UPDATE：一条重放记录一旦写下就不该改——能改，就等于幂等的判据在运行期可变。
-- DELETE 是必要的：容器随组织级联消失时这行要跟着走（复合外键 ON DELETE CASCADE）。
GRANT SELECT, INSERT, DELETE ON project_creation_requests TO app_rw;

-- ⚠ 列级 GRANT 在这里**没有加**，且这是一个判断不是遗漏：
--   本表五列没有一列比 `projects.name` 更敏感（`fingerprint` 是 name 等入参的散列，
--   `actor_id` 在 `provenance_events` 里已经是可查的）。0019 的列级 GRANT 挡的是
--   模型池里的凭据列，那里存在「能读表但不该读某一列」的角色；这里不存在那样的角色，
--   加一层只会让下一个人以为有什么东西被保护着。

/* ═══════════════ 三、F22 的停用冻结 ═══════════════ */

-- 必须显式调用一次：0014 的编号在前，首次跑迁移时本表还不存在。
-- 少了这一行的表现是：新库上本表没有冻结，而 F22 的全部断言依旧全绿
-- （它们测的是当时已存在的那些表）。规则本身仍只声明在 0014。
--
-- ⚠ 语义上这一条是必需的而不是「顺手对齐」：组织被停用后 `projects` 的写被
--   RESTRICTIVE 策略拒掉（I-P28），若重放表还能写，一次创建会留下一条
--   指向不存在容器的重放记录——下一次同样的请求就会拿着它去查一个查不到的容器。
SELECT kernel_apply_org_freeze_policies();
