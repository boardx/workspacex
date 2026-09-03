/*
 * FB-2 补——反馈闭环反向对账（issue #2500 落地,`FeedbackGithubIssuePollWorker`）需要
 * 跨组织看"哪些反馈挂着 GitHub issue、还没关闭",但 `product_feedback` 跟每张租户表
 * 一样挂着 `FORCE ROW LEVEL SECURITY`（见 0003 的通用处理）。`app_rw` 走
 * `withoutTenant`（不设置 `app.current_org`)时,RLS 策略 `org_id = current_setting(
 * 'app.current_org', true)` 恒不满足——`DatabasePort.withoutTenant` 自己的头注写得
 * 明明白白:"业务查询必须不用这个:策略是 fail-closed 的,读到的是看起来正常的
 * 『没有数据』,是最难查的一类 bug"。
 *
 * PR #2580 独立复核抓到的正是这个坑的实例:`pg-feedback-github-issue-scanner.ts`
 * 第一版直接 `SELECT ... FROM product_feedback` 包在 `withoutTenant` 里——语法能过
 * 静态 lint(它只查表名/列名,查不出运行时 RLS 会把结果集清空),但那个 worker
 * 从建出来那一刻起就**没有真的同步过任何东西**,只是不报错、看起来在正常轮询。
 *
 * ## 修法:同 `kernel_org_is_writable`(0014)/`kernel_user_org_ids`(0010)一个形状
 *
 * 一个窄得不能再窄的 `SECURITY DEFINER` 函数——`WHERE` 条件焊死在函数体内部
 * （状态='已进入迭代' 且挂着 issue),不接受任何参数(调用方因此连"传个别的 WHERE
 * 进来"的空子都没有),只投影五个字段:`id`/`org_id`/`submitted_by`/`title`/
 * `github_issue_number`——D3 判定下全组织可见的那五列（见
 * `application/feedback/ports.ts` 的 `FeedbackRow` 头注),**不选 `detail`**。
 *
 * ⚠ **不是** `kernel_read_error_logs`(error_logs 那条)那种"新建专用角色 `app_diag_ro`、
 *   `app_rw` 对该函数一无所有"的重量级隔离——那条防的是**诊断内容本来就不该被
 *   `app_rw` 这个业务运行时身份读到**,哪怕只是换个函数名系统调用,因为诊断内容是
 *   运维专用、不是这个运行时身份份内该看的东西。这里五个字段是**普通业务数据**:
 *   `app_rw` 在正常租户上下文里本来就能读到同一条反馈的同样五列
 *   （`pg-product-feedback-repository.ts` 的 `findById`/`list`,都在 `app_rw` 的
 *   `SELECT` 权限范围内)。这个函数唯一去掉的前提是"必须先知道 orgId 才能查",
 *   没有打开任何 `app_rw` 原本读不到的信息类别。EXECUTE 因此直接授给 `app_rw`,
 *   同 `kernel_user_org_ids` 的先例——那个函数同样是"app_rw 本来就有权限知道的
 *   事实,只是需要跨租户一次查全,不该为它单独造一个新角色"。
 *
 * Replayable：`CREATE OR REPLACE`,重放安全。
 */

CREATE OR REPLACE FUNCTION kernel_read_open_feedback_with_github_issue()
RETURNS TABLE (
  id                   text,
  org_id               text,
  submitted_by         text,
  title                text,
  github_issue_number  integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT f.id, f.org_id, f.submitted_by, f.title, f.github_issue_number
    FROM product_feedback f
   WHERE f.status = '已进入迭代' AND f.github_issue_number IS NOT NULL;
$$;

COMMENT ON FUNCTION kernel_read_open_feedback_with_github_issue() IS
  'FB-2 补——反向对账 worker(issue #2500)专用的跨组织读。SECURITY DEFINER 绕开 '
  'product_feedback 的 FORCE ROW LEVEL SECURITY;WHERE 条件焊死在函数体内(状态=已进入'
  '迭代 且挂着 github_issue_number),不接受任何参数;只投影五个 D3 判定下全组织可见的'
  '字段,从不选 detail 正文。见 pg-feedback-github-issue-scanner.ts 头注。';

-- ⚠ 必须在 GRANT 之前——PostgreSQL 新建函数默认对 PUBLIC 开放 EXECUTE,不显式收回
--   的话,GRANT 给 app_rw 这一步就是多余的仪式:任何角色都已经能通过 PUBLIC 继承到
--   执行权限。同 kernel_read_error_logs / kernel_org_is_writable 的既有模式。
REVOKE ALL ON FUNCTION kernel_read_open_feedback_with_github_issue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_read_open_feedback_with_github_issue() TO app_rw;
