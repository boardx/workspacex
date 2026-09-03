/*
 * FB-2 —— "转开发"创建的 GitHub issue 落在反馈本体上的两列。
 *
 * 契约：`packages/contracts/src/feedback-loop.ts` 的 `triageFeedback.out.githubIssueUrl`。
 * 用例：`apps/api/src/application/feedback/triage-feedback.ts`。
 *
 * ## 为什么只加两列，不建一张新表
 *
 * 一条反馈**最多**对应一个 GitHub issue（"转开发"只会在它第一次进入 `已进入迭代`
 * 时创建一次——见用例层"只在 issue 尚未创建时才建"的判断）。1:0..1 的关系用两个
 * 可空列表达就够了；建一张 `product_feedback_github_issues` 表是为一个永远只有
 * 0 或 1 行的关系多背一次 join，而且这两列**不是**历史事实的一部分（不像
 * `product_feedback_status_events`——那张表记的是"发生过几次"，这两列记的是
 * "当前唯一那一个是什么"）。
 *
 * ## 为什么这两列**可以**被 UPDATE，而不像正文/标题那样被免疫触发器挡住
 *
 * `fb2_product_feedback_immutable_columns()` 触发器（见
 * `20260815140000_fb2_product_feedback.sql`）逐列列出不可变列，本迁移
 * `CREATE OR REPLACE` 那个函数、把新列排除在检查之外——不改列表就是把新列
 * 静默纳入"不可变"，而 issue 创建**恰好**是在反馈落库之后才发生的一次写回，
 * 它必须能被 UPDATE。
 *
 * ⚠ 不加 UNIQUE 约束：GitHub 那边的 issue 号是它自己发的，这里只是存一份回执。
 *   两条反馈各自生成的 issue 号在数值上永远不会相等，但那是 GitHub 保证的，
 *   不是这张表该重复断言的东西。
 *
 * Replayable：IF NOT EXISTS / OR REPLACE，重放安全。
 */

ALTER TABLE product_feedback
  ADD COLUMN IF NOT EXISTS github_issue_url text NULL,
  ADD COLUMN IF NOT EXISTS github_issue_number integer NULL;

CREATE OR REPLACE FUNCTION fb2_product_feedback_immutable_columns() RETURNS trigger AS $$
BEGIN
  IF NEW.id              IS DISTINCT FROM OLD.id
     OR NEW.org_id          IS DISTINCT FROM OLD.org_id
     OR NEW.submitted_by    IS DISTINCT FROM OLD.submitted_by
     OR NEW.kind            IS DISTINCT FROM OLD.kind
     OR NEW.target_kind     IS DISTINCT FROM OLD.target_kind
     OR NEW.target_agent_id IS DISTINCT FROM OLD.target_agent_id
     OR NEW.target_skill_id IS DISTINCT FROM OLD.target_skill_id
     OR NEW.target_label    IS DISTINCT FROM OLD.target_label
     OR NEW.title           IS DISTINCT FROM OLD.title
     OR NEW.detail          IS DISTINCT FROM OLD.detail
     OR NEW.occurred_route  IS DISTINCT FROM OLD.occurred_route
     OR NEW.app_version     IS DISTINCT FROM OLD.app_version
     OR NEW.created_at      IS DISTINCT FROM OLD.created_at
  THEN
    -- ⚠ github_issue_url / github_issue_number **故意不在上面这份名单里**——
    --   它们是本迁移新加的、允许被 UPDATE 的两列。见文件头。
    -- ⚠ 异常文案**保留原有前缀不变**（`only status/status_reason are mutable`）：
    --   `product-feedback-persistence.test.ts` 那条正则锚定的就是这句话，
    --   把它整句改掉只是在为一个语义没变的事实换一种写法，却要去动一份已经
    --   证明过"只有这两列能改"的测试——真正变化的是"多了哪两列"，用括注补充
    --   比重写整句更诚实地反映了这条修改的范围。
    RAISE EXCEPTION 'product_feedback: only status/status_reason are mutable (plus github_issue_url/github_issue_number, added 2026-08-30)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
