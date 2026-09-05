/*
 * 2026-09-05 —— 设计方案「转开发」：把一个已推送的设计方案变成一张 GitHub issue。
 *
 * ## 补的是哪一段断裂
 *
 * UC-17.8 把「高级用户做原型 → 推送到收件箱 → 后台转开发」这条链路做到了第二步就停了：
 * `pushToInbox` 只标 `pushed`、回写来源反馈的 `resolved_by_design_id`、给提交人发一封
 * 「已生成设计方案」的邮件。收件箱里 `kind = "design"` 的条目**没有任何操作**——
 * `inbox.ts` 的 `InboxGithubRef` 头注逐字写着「设计方案：本轮恒 `null`」，
 * `inbox-screen.tsx` 三处显式 `if (item.kind === "design") return;`。
 * 也就是说：方案能进收件箱，但进去之后就是一条死条目，没法交给开发。
 *
 * 这三列让它能走完最后一步，形状**逐字照抄** `product_feedback` 已经验证过的那一套
 * （`20260830120000` + `20260831010000`），不发明第二套：
 *   · `github_issue_url` / `github_issue_number`：建成之后回填。
 *   · `github_issue_claimed_at`：乐观自愈锁，防「两个并发请求给同一个方案建两张票」。
 *     语义与过期判定完全同 `product_feedback.github_issue_claimed_at`，那份迁移的
 *     长头注是这把锁的权威说明（含它**不**解决的第二种竞态：外部调用成功但没写回，
 *     GitHub 建 issue 没有幂等键），这里不复述、也不假装解决得更多。
 *
 * ## 为什么不顺手加一个 `dev_status` 列
 *
 * 加了就有两份事实源：一份在这张表，一份是 GitHub 上那张 issue 的开关状态，
 * 两者必然漂移（本仓已经因为「同一事实声明在两处」栽过五次，见 AGENTS.md）。
 * 设计方案的开发状态**就是**那张 issue 的状态：
 *   · 没有 issue ⇒ 收件箱 stage = `backlog`（还没转开发）
 *   · 有 issue   ⇒ stage = `doing`（已转开发）
 * 这条派生规则写在契约 `inbox.ts` 里、由 `inbox-projection.ts` 单点实现，不落库。
 * 「issue 关掉之后方案应该显示成 done」需要一个像 `FeedbackGithubIssuePollWorker`
 * 那样的对账 worker 来源（那条 poller 今天只扫 `product_feedback`，见
 * `pg-feedback-github-issue-scanner.ts` 硬编的 SQL 函数）——**本迁移不假装做了那一半**，
 * 它是如实登记的已知缺口，不是被这三列悄悄解决掉的东西。
 *
 * Replayable：三条都是 IF NOT EXISTS，重放安全。
 */

ALTER TABLE design_projects
  ADD COLUMN IF NOT EXISTS github_issue_url text NULL,
  ADD COLUMN IF NOT EXISTS github_issue_number integer NULL,
  ADD COLUMN IF NOT EXISTS github_issue_claimed_at timestamptz NULL;
