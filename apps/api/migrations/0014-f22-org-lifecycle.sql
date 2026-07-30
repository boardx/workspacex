-- 0012 F22: 组织停用 = 只读降级，在**数据库层**冻结写（O-29 ③ / UC-1.5 V12 / coverage A-2）
--
-- ## 为什么冻结写这件事必须在 RLS 里，而不是在 application 里
--
-- auth 的 domain.md 把「强制」这一格明确划给 PG RLS。若「停用后不能写」由 application 判，
-- 那么它对**下一个新增的 controller** 是不存在的：新写的路由不会知道要问一句
-- 「这个组织是不是停用了」，而漏掉的那次不会报错——它会**成功写入一个已停用组织**，
-- 然后这份数据在留存期结束时被连带销毁，或者更糟，留下来。
-- 这与 0004 的论证同构：一条靠人记得的规则，缺的正好是刚加的那张表。
--
-- ## 只动 WITH CHECK，不动 USING —— 这就是「只读降级」四个字的字面实现
--
--   USING      （读）不变 → 停用组织的成员**仍然读得到**自己的数据（V12 ③「仍可查询到」）
--   WITH CHECK （写）加一条 → INSERT/UPDATE 一律被库拒掉（V12 ①「全部写接口被拒」）
--
-- ⚠ 这也是为什么本迁移**不能**用「blanket deny」偷懒：停用与销毁是两件事，
-- 把读也关掉就等于提前销毁，而 O-29 ③ 要求数据留到期。
-- `org-disabled-readonly.test.ts` 两个方向都断言（写被拒 ∧ 读仍通），
-- 否则「瘫痪」会伪装成「隔离」——verify-rls.sh 的文件头讲的是同一件事。
--
-- ## 哪些表被冻结：从 catalog 推，不写名字
--
-- 「带 org_id **且该 org_id 有指向租户根表的外键**」。两个条件都要：
--   * 只看 org_id 会把 `rls_probe` 圈进来——它有 org_id 而**没有**外键，
--     它的 'org-a'/'org-b' 在 organizations 里根本不存在。冻结它会让
--     verify-rls.sh 的 seed 写不进去，而那张表是 RLS 的证据表，不许动（F18/UC-0.6 R7）。
--   * 租户根表（organizations 自己）也排除，理由见下。
--
-- 与 `kernel_tenant_table_audit()` 同源的推导方式，同样的理由：手维护的列表缺的
-- 永远是刚加的那张表。⚠ 但**本迁移只能改它运行时已经存在的表**——
-- 以后新建的表带着 0003 那种老式策略进来，就不在冻结范围内了。
-- 那个洞不是靠注释堵的：`org-disabled-readonly.test.ts` 里有一条 catalog 断言，
-- 任何带外键的租户表只要 with_check 里没有 `kernel_org_is_writable`，测试就红。
--
-- ## 为什么 organizations 自己不被冻结
--
-- 它**承载**冻结标记。冻结它，`status` 就再也改不回 'active'——
-- 一个只能进不能出的状态，等于把「停用」偷偷变成了「删除」。
-- 代价如实说明：停用组织的名称/model_policy 仍可被写。这是刻意的边界，
-- 不是遗漏：冻结保护的是租户**内容**，组织自己的生命周期行是那把锁本身。
--
-- Replayable: 全部 IF NOT EXISTS / OR REPLACE / DROP-then-CREATE，
-- 因为 migrate:check 会忽略版本表重放每个文件。

/* ─────────────── organizations 的生命周期列 ─────────────── */

-- ⚠ `ADD COLUMN IF NOT EXISTS` 而不是把列塞进 0003 的 CREATE TABLE：
-- 0003 是 `CREATE TABLE IF NOT EXISTS`，在**表已存在的库上是静默空操作**
-- （0010 末尾那段事故记录讲的就是这件事）。改 0003 只会在全新库上生效。
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
-- ⚠ **没有 DEFAULT now() + interval '180 days'**。留存期只有一份，在
-- `packages/contracts/src/auth.ts` 的 `AUTH_POLICY.orgRetentionDays`，
-- 由 application 算好写进来。库里再写一个默认值就是第二份副本，
-- 而漂移方向是「TS 改了、SQL 没改」——两边都不报错，新旧停用组织按两套策略。
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS retention_until timestamptz;

-- 补齐块：约束单独加，理由同 0010 末尾——`ADD COLUMN IF NOT EXISTS` 在列已存在时
-- 是空操作，跟着它写的 CHECK 一条都不会生效，而失败要等到某次 UPDATE 才浮出来。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'organizations'::regclass AND conname = 'organizations_status_known'
  ) THEN
    -- ⚠ 只有两个取值。刻意**没有** 'purged'：phase-00 没有任何销毁调度器，
    -- 加一个取值会让 schema 替一条不存在的链路背书（契约 KNOWN_CONTRACT_GAPS.C13）。
    ALTER TABLE organizations ADD CONSTRAINT organizations_status_known
      CHECK (status IN ('active', 'disabled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'organizations'::regclass AND conname = 'organizations_disabled_is_atomic'
  ) THEN
    -- 三个字段同生共死。「停用了但不知道什么时候能删」不是更宽松的状态，
    -- 而是 O-29 ③ 唯一要求记住的那件事**恰好丢了**的状态。
    ALTER TABLE organizations ADD CONSTRAINT organizations_disabled_is_atomic
      CHECK (
        (status = 'disabled') = (disabled_at IS NOT NULL)
        AND (disabled_at IS NULL) = (retention_until IS NULL)
      );
  END IF;
END $$;

/* ─────────────── 「这个组织现在可写吗」的唯一判定 ─────────────── */

-- SECURITY DEFINER，因为它要被**策略本身**调用。
--
-- ⚠ 不是为了提权，是为了可判定：organizations 自己也是 FORCE RLS 的，
-- 策略里直接子查询它，会在「当前租户上下文 ≠ 被查组织」时读到零行，
-- 于是判定退化成「查不到 ⇒ 放行」——一个**默认放行**的安全判定。
-- DEFINER 让它总是看得见那一行，判定因此只有一个来源：status 列本身。
--
-- COALESCE(..., true)：organizations 里**没有这一行**时判为可写。
-- 这不是兜底放行，是范围声明——`rls_probe` 的 'org-a'/'org-b' 不是组织，
-- 没有生命周期可言，冻结它只会让 RLS 的证据表写不进去。
-- 真正的租户表都有 org_id → organizations 的外键，行必然存在。
CREATE OR REPLACE FUNCTION kernel_org_is_writable(p_org text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
-- DEFINER 函数必须钉死 search_path：否则调用方可以把名字解析到自己建的
-- `public.organizations` 上（0010 的 kernel_user_org_ids 是同样的写法与同样的理由）。
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT o.status = 'active' FROM organizations o WHERE o.id = p_org), true);
$$;

COMMENT ON FUNCTION kernel_org_is_writable(text) IS
  'F22 / O-29 ③: 组织停用后的只读降级判定，被每张租户表的 RLS WITH CHECK 调用。'
  'SECURITY DEFINER 是为了让它总是看得见 organizations 那一行——策略里裸子查询会在'
  '租户上下文不匹配时读到零行，把判定退化成默认放行。organizations 里没有该行时返回 true：'
  '那不是组织（rls_probe），没有生命周期可冻结。';

GRANT EXECUTE ON FUNCTION kernel_org_is_writable(text) TO app_rw;

/* ─────────────── 把冻结装进每一张租户表 ─────────────── */

-- ⚠ **RESTRICTIVE，而且必须是三条分开的。** 两处都踩过，都是绿着踩的：
--
-- ① 第一版把 0003 那条 `..._tenant` 策略重写成
--    `WITH CHECK (org_id = ... AND kernel_org_is_writable(org_id))`。能用，
--    但它把「租户隔离」和「停用冻结」搅进同一条策略里——以后谁重跑 0003
--    （replay、或新库先跑 0003 再跑 0012 之外的顺序），冻结就没了，
--    而 verify-rls.sh 依然全绿，因为它只看租户那一半。
--    ⇒ 冻结独立成策略，0003 那条一字不动。
--
-- ② 独立策略若是 **PERMISSIVE**（默认），它与既有策略是 **OR**——
--    多加一条宽松策略只会**放宽**权限，一条也挡不住。
--    RESTRICTIVE 才是 AND。这一条差别在测试里完全看不出来：
--    permissive 版本下「写被拒」的断言依然会红/绿如常吗？不会——它会全绿地放行。
--
-- ③ 为什么不是一条 `AS RESTRICTIVE FOR ALL`：`FOR ALL` 的 USING 也作用于 **SELECT**，
--    于是停用组织连读都读不到——那不是只读降级，那是提前销毁（V12 ③ 直接违反）。
--    ⇒ INSERT / UPDATE / DELETE 各一条，SELECT 一条都不加。
--
-- ④ DELETE 必须单列：`WITH CHECK` 只作用于 INSERT/UPDATE 的**新行**，DELETE 没有新行。
--    漏掉它的表现是「插不进、改不了、但删得掉」，而「写被拒」的断言全绿。
-- ⚠ 2026-07-30（F17）：这段从 `DO $$ ... $$` 改成一个**函数**，并在文件末尾调用它。
--
-- 理由不是复用的美感，是一次真实的失败：F17 新建了租户表 `local_export_previews`，
-- 而本文件的编号在它之前——首次跑迁移时这张表还不存在，于是它拿不到三条冻结策略；
-- 只有 `migrate:check` 的**强制重放**（忽略版本表、按序再跑一遍）才会补上，
-- 表现为「重放后 schema 摘要不一致」。也就是说：**新库上的新租户表默认没有冻结**，
-- 而 F22 的全部断言依旧全绿——它们测的是当时已存在的那些表。
--
-- 把规则做成函数之后，任何后续迁移在建完自己的租户表后调用一次即可，
-- 而规则本身仍然**只声明在这一处**（在这里再抄一份三条策略才是第二份事实源）。
CREATE OR REPLACE FUNCTION kernel_apply_org_freeze_policies() RETURNS void AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    -- 带 org_id、且该 org_id 有指向租户根表的外键的普通表。
    -- 根表自己（organizations）不在其中：它没有 org_id，且它承载冻结标记本身。
    -- rls_probe 也不在其中：它有 org_id 但**没有外键**，它的 org 不是组织。
    SELECT c.relname::text AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND EXISTS (
         SELECT 1 FROM pg_constraint con
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
          WHERE con.conrelid = c.oid
            AND con.contype = 'f'
            AND a.attname = 'org_id'
            AND array_length(con.conkey, 1) = 1
       )
  LOOP
    -- DROP + CREATE（不是 ALTER POLICY）：replay 时策略已存在，ALTER 只能改表达式
    -- 不能改 permissive/restrictive，而那正是最容易改错的一位。
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.name || '_org_frozen_ins', r.name);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT '
      'WITH CHECK (kernel_org_is_writable(org_id))',
      r.name || '_org_frozen_ins', r.name);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.name || '_org_frozen_upd', r.name);
    -- UPDATE 只挡新行（WITH CHECK），不挡「哪些行可被选中」（USING）：
    -- USING 收紧会让停用组织的行连 SELECT ... FOR UPDATE 都选不中，
    -- 而 UPDATE 的 USING 与 SELECT 的可见性在实现上纠缠，收它风险大于收益。
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE '
      'WITH CHECK (kernel_org_is_writable(org_id))',
      r.name || '_org_frozen_upd', r.name);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.name || '_org_frozen_del', r.name);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE '
      'USING (kernel_org_is_writable(org_id))',
      r.name || '_org_frozen_del', r.name);
  END LOOP;
END
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION kernel_apply_org_freeze_policies() IS
  'F22 的三条 RESTRICTIVE 冻结策略，按 pg_catalog 找出全部租户表后逐张安装。'
  '⚠ 建了新的租户表之后必须调用一次——否则那张表在新库上没有冻结，而 F22 的断言仍全绿。';

SELECT kernel_apply_org_freeze_policies();

-- ⚠ 注意 organizations **没有** 上面两段的任何一条：ON DELETE CASCADE 会从
-- organizations 一路删下去，而删除组织本身在 phase-1 是不提供的路径
-- （O-29 ③「硬删除不在 phase-1 范围」，且契约里禁止 `DELETE /organizations`，
-- 见 packages/contracts/tests/no-forbidden-routes.test.ts）。
-- 测试夹具通过 owner（superuser，绕过 RLS）清理，与 resetOrgs 一致。
