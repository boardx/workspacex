/*
 * FB-2 二轮独立审查（PR #2431）阻断项①——"转开发"建 GitHub issue 不是并发/崩溃安全的。
 *
 * ## 具体是什么竞态
 *
 * `triageFeedback` 原来的形状是：`findById` 读到 `githubIssueUrl === null` →
 * 调 GitHub 建 issue → `setGithubIssue` 回填。这三步**不是一个原子操作**：
 *   · 两个并发请求都能在对方写回之前读到 `null`，各自建一个 issue——同一条反馈
 *     挂出两张票。
 *   · GitHub 调用成功之后、`setGithubIssue` 写回之前进程崩溃，issue 建出来了，
 *     但库里不知道——下一次重试会再建一张。
 *
 * ## 这一列解决第一种（常见），不解决第二种（罕见且 GitHub API 本身没有幂等键）
 *
 * `github_issue_claimed_at` 是一把**乐观、自愈的锁**：谁能把它从
 * `NULL`（或"够旧的旧值"）原子地改成"现在"，谁才有权去调 GitHub；改不动的人
 * 直接知道"别人正在办或已经办完了"，不会重复调用外部 API。
 *   · 并发的两个请求：`UPDATE ... WHERE github_issue_claimed_at IS NULL ... RETURNING`
 *     在数据库层面天然只有一个赢家（同一行上的 UPDATE 互斥），另一个 `RETURNING`
 *     零行，用例层据此判"这条正在被别人处理"，不再调 GitHub。
 *   · 进程崩溃留下的 claim：不清空就会永久卡死这条反馈的重试。所以 claim 有
 *     "多旧算过期"（应用层判断，见 `pg-product-feedback-repository.ts` 的
 *     `claimGithubIssueCreation`），过期的 claim 可以被下一次重试重新抢到。
 *
 * 第二种情形（外部调用成功但没写回）**没有**在这里被彻底解决——GitHub 的
 * issue 创建接口不支持幂等键，我们这边也没有"事后去 GitHub 查有没有建过"的
 * 读端点可用（真要做需要按标题/来源标记反向搜索 issue，属于另一轮工作量，
 * 已在 PR #2431 里如实记录为已知限制，不是本迁移假装解决的东西）。这一列
 * 缩小的是这个窗口的触发概率（claim 覆盖了从"决定要建"到"写回成功"的全程），
 * 不是把窗口关成零。
 *
 * Replayable：IF NOT EXISTS，重放安全。
 */

ALTER TABLE product_feedback
  ADD COLUMN IF NOT EXISTS github_issue_claimed_at timestamptz NULL;
