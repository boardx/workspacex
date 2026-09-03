-- 系统异常的生命周期管理 + 标签（人类 2026-09-03 要求：「反馈与迭代 → 系统异常」要跟
-- 缺陷反馈一样能标签管理、能转下一步——转「已转入开发」需要一个可填写的说明字段，
-- 也可以转「不做」做存档；同一张表加标签，供筛选/搜索）。
--
-- ## 为什么不是 `product_feedback` 那一整套（domain 状态机 + 状态流水表 + GitHub issue +
--    邮件通知）
--
-- `error_logs` 与 `product_feedback` 是两类不同的东西：后者是**用户提交**的、需要
-- 回应提交人（邮件通知、GitHub issue 联动）的一条反馈；前者是**系统自动捕获**的异常，
-- 没有"提交人"这个角色要通知，本次人类要求的范围只是"状态可以往前推、可以存档、
-- 能打标签筛选"——不比照 `product_feedback` 建一张状态流水表/邮件通知/GitHub 联动，
-- 那是这个用户要求以外的范围（见 AGENTS.md「范围纪律」）。当前状态/理由/备注直接落在
-- `error_logs` 行上，不是不需要审计，是这一轮明确不做，需要时再登记 issue 补一张事件表。
--
-- ## 为什么还是走 SECURITY DEFINER 函数，不直接 GRANT UPDATE/SELECT
--
-- `error_logs` 既有边界（见 20260901024515 头注）：`app_rw` 不能裸 SELECT/UPDATE 这张表，
-- 诊断内容（msg/detail）只有 `app_diag_ro` 能读。这条边界本次不放宽——新增的
-- status/status_reason/dev_note/tags 四列同样只能通过下面两个新函数读写，`list()`
-- 改读的函数只授给 `app_diag_ro`，与既有 `kernel_read_error_logs_with_ai_summary`
-- 同一套权限模型（见该函数注释）。
--
-- ## 2026-09-03 独立评审（PR #2590 review）三处阻断项的修法，登记在这里
--
-- ① **"不做必须有理由"是一条终态不变量，不是一条只在转移那一刻检查的规则**——
--   之前的写法只在 `isTransition` 为真时校验，幂等重放（目标状态==当前状态）或
--   "只改标签"这类局部更新会绕过检查，把一条已经是「不做」的行悄悄改成 `status_reason
--   = NULL`。修法：应用层（`update-system-error-lifecycle.ts`）不再区分"是不是转移"，
--   只要最终状态是「不做」就必须有非空理由，只要不是「不做」就强制清空理由（离开「不做」
--   自动清掉旧理由——见下方对"退回待处理要不要带着旧理由"的裁决：不带，理由只属于
--   「不做」这一个状态，语义上等价于"存档理由"，翻回来就不再是"存档"了）；同时
--   **禁止在不随 `status` 一起提交的情况下单独改 `status_reason`**——这是"只改标签
--   顺带清理由"这类绕过口子的根：一次只碰标签/备注的请求，压根不允许携带
--   `status_reason` 字段。DB 侧再加一条 CHECK（`error_logs_status_reason_pairing_check`）
--   兜底："status <> '不做' 或 status_reason 非空"，即使未来某条写路径绕开了应用层校验，
--   这条约束仍然拦得住。
--
-- ② **读-改-写的 TOCTOU / lost update**——旧写函数无条件覆盖全部四列，两个并发请求
--   各自读到同一份快照、各自只想改其中一列，后写的那个会把先写的那个悄悄冲掉；
--   状态转移的合法性也是"用一次单独查询读到的旧状态"校验的，写入时不再确认那个旧状态
--   还成立。修法：`kernel_write_error_log_lifecycle` 改成**只写调用方明确要改的那些列**
--   （每列配一个 `p_set_*` 开关，`CASE WHEN` 决定改还是保持原值——纯标签编辑天然不会
--   冲掉别人刚改的开发备注或状态），且**在同一条 UPDATE 里做乐观锁**：只有调用方带的
--   `p_expected_status` 与当前行的 `status` 相同才真正生效（`status` 没变的请求传
--   `NULL` 表示不设防，因为它压根不碰这一列）。CAS 失败（行存在但 `status` 已经被
--   别人先改过）返回零行，应用层据此抛 `CONCURRENT_UPDATE`，调用方刷新后重试——
--   不是"静默按旧状态覆盖"。

ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT '待处理';
ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS status_reason text;
ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS dev_note text;
ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'error_logs_status_check'
  ) THEN
    ALTER TABLE error_logs
      ADD CONSTRAINT error_logs_status_check CHECK (status IN ('待处理', '已转入开发', '不做'));
  END IF;
END $$;

-- 终态不变量①：只有「不做」这个状态携带存档理由——DB 侧兜底，独立于应用层校验
-- （见文件头①）。所有既存行此刻的 `status` 恒为默认值 '待处理'（这四列同一条迁移
-- 里新增），天然满足这条约束，不需要回填。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'error_logs_status_reason_pairing_check'
  ) THEN
    ALTER TABLE error_logs
      ADD CONSTRAINT error_logs_status_reason_pairing_check
      CHECK (status <> '不做' OR (status_reason IS NOT NULL AND btrim(status_reason) <> ''));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS error_logs_status_idx ON error_logs (status);
-- GIN 索引供"按标签筛选"用（即便当前只在应用层用 `&&`/`@>`，索引先建好，
-- 不为一条以后可能要用的查询单独再开一次迁移）。
CREATE INDEX IF NOT EXISTS error_logs_tags_idx ON error_logs USING GIN (tags);

-- 用来在写之前校验转移合法性、判定"这个 id 存不存在"——四列都是生命周期管理本身的
-- 字段，不是诊断内容（msg/detail），放行给 app_rw 不违反"诊断内容只有 app_diag_ro
-- 能读"这条边界。**真正的正确性不靠这次读取**（见文件头②：读到的快照可能在写之前
-- 就过期了）——它只用于"该不该允许这次请求 / 给用户看什么当前值"，实际写入靠
-- `kernel_write_error_log_lifecycle` 自带的乐观锁。
CREATE OR REPLACE FUNCTION kernel_read_error_log_lifecycle(p_id bigint)
RETURNS TABLE (status text, status_reason text, dev_note text, tags text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.status, e.status_reason, e.dev_note, e.tags FROM error_logs e WHERE e.id = p_id;
$$;

COMMENT ON FUNCTION kernel_read_error_log_lifecycle(bigint) IS
  '应用层预检（是否存在/转移是否合法）用的窄口径读取——不是诊断内容（msg/detail）；
   不是并发正确性的来源，见 kernel_write_error_log_lifecycle 的乐观锁。';

REVOKE ALL ON FUNCTION kernel_read_error_log_lifecycle(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_read_error_log_lifecycle(bigint) TO app_rw;

-- 系统异常生命周期的唯一写入口——见文件头②：只写调用方明确要改的列
-- （`p_set_*` 开关 + `CASE WHEN`），且用 `p_expected_status` 做乐观锁：调用方要改
-- `status` 时必须带上它读到的旧状态,只有这一行的 `status` 此刻仍等于那个旧状态才
-- 真正更新;不改 `status` 的请求传 NULL,不设防（纯标签/备注编辑不该被别人的状态
-- 转移拦住,它压根不碰 status 这一列）。CAS 失败或 id 不存在都返回零行,两者由
-- 调用方（应用层已经用 `kernel_read_error_log_lifecycle` 先判过存在性）区分。
CREATE OR REPLACE FUNCTION kernel_write_error_log_lifecycle(
  p_id bigint,
  p_expected_status text,
  p_set_status boolean, p_status text,
  p_set_status_reason boolean, p_status_reason text,
  p_set_dev_note boolean, p_dev_note text,
  p_set_tags boolean, p_tags text[]
)
RETURNS TABLE (status text, status_reason text, dev_note text, tags text[])
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE error_logs e
     SET status        = CASE WHEN p_set_status        THEN p_status        ELSE e.status        END,
         status_reason = CASE WHEN p_set_status_reason THEN p_status_reason ELSE e.status_reason END,
         dev_note      = CASE WHEN p_set_dev_note      THEN p_dev_note      ELSE e.dev_note      END,
         tags          = CASE WHEN p_set_tags          THEN p_tags          ELSE e.tags          END
   WHERE e.id = p_id
     AND (p_expected_status IS NULL OR e.status = p_expected_status)
  RETURNING e.status, e.status_reason, e.dev_note, e.tags;
$$;

COMMENT ON FUNCTION kernel_write_error_log_lifecycle(bigint, text, boolean, text, boolean, text, boolean, text, boolean, text[]) IS
  '系统异常生命周期（状态/理由/开发备注/标签）的唯一写入口。SECURITY DEFINER 以表主体
   身份运行，EXECUTE 只授给 app_rw；函数体写死了列名，app_rw 因此不能借道这个函数
   触达 msg/detail 之外的任何写权限，更不能裸 UPDATE 这张表。只写 p_set_* 为真的列
   （字段级部分写入，避免并发的另一次局部编辑被整行覆盖），status 变更受
   p_expected_status 乐观锁保护（避免用一个已经过期的旧状态覆盖别人刚做的转移）。
   零行返回 ⟺ id 不存在，或 CAS 未命中（并发冲突）。';

REVOKE ALL ON FUNCTION kernel_write_error_log_lifecycle(bigint, text, boolean, text, boolean, text, boolean, text, boolean, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_write_error_log_lifecycle(bigint, text, boolean, text, boolean, text, boolean, text, boolean, text[]) TO app_rw;

-- `list()` 的新读路径——比 `kernel_read_error_logs_with_ai_summary` 多 status/
-- status_reason/dev_note/tags 四列。不能 `CREATE OR REPLACE` 旧函数改返回类型
-- （20260902160000 头注已经用真实 Postgres 验证过这一点），所以是新函数、新名字，
-- 旧函数原样保留（既有测试仍直接调用它，行为不变）。
CREATE OR REPLACE FUNCTION kernel_read_error_logs_with_lifecycle(p_limit integer, p_before_id bigint DEFAULT NULL)
RETURNS TABLE (
  id bigint, trace_id text, msg text, detail jsonb, created_at timestamptz,
  ai_title text, ai_summary text,
  status text, status_reason text, dev_note text, tags text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.trace_id, e.msg, e.detail, e.created_at, e.ai_title, e.ai_summary,
         e.status, e.status_reason, e.dev_note, e.tags
    FROM error_logs e
   WHERE p_before_id IS NULL OR e.id < p_before_id
   ORDER BY e.id DESC
   LIMIT LEAST(GREATEST(p_limit, 0), 200);
$$;

COMMENT ON FUNCTION kernel_read_error_logs_with_lifecycle(integer, bigint) IS
  '`kernel_read_error_logs_with_ai_summary` 的替代读路径（多生命周期/标签四列）——同一套
   权限模型，EXECUTE 只授给 app_diag_ro，PUBLIC 已显式 REVOKE。';

REVOKE ALL ON FUNCTION kernel_read_error_logs_with_lifecycle(integer, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_read_error_logs_with_lifecycle(integer, bigint) TO app_diag_ro;
