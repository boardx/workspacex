# ADR-108: 反馈闭环两条出站集成 —— GitHub issue 建立 + 状态变更邮件

- 状态: Accepted
- 适用层：项目实现（专属）
- 日期: 2026-08-30

## 背景

`triageFeedback`（`PUT /feedback/:feedbackId/status`，契约
`packages/contracts/src/feedback-loop.ts`）此前只做一件事：把 `product_feedback`
的状态改掉、写一条 `product_feedback_status_events`。分诊之后发生了什么，对
GitHub 上的开发流程、对提交这条反馈的人，都是不可见的——"转开发"只是把一个
内部状态标了一下，没有任何东西真的进入开发排期；状态变到"已修复"/"不做"，
提交人也只有回到后台屏才知道。

## 决策

在 `triageFeedback` 用例内新增两个 egress seam，都通过依赖注入的端口调用，
用例本身不直接 `fetch` 或读 `process.env`：

1. **转 `已进入迭代`（"转开发"）时建一个真实 GitHub issue**（`boardx/workspacex`）。
   - 端口：`application/feedback/notification-ports.ts` 的 `GithubIssueCreator`。
   - 适配器：`infrastructure/feedback/github-issue-creator.ts` 的
     `FetchGithubIssueCreator`——纯 `fetch`，不装 `octokit`；用 classic PAT
     （`GITHUB_ISSUE_TOKEN`），不用 `packages/coord-projection/src/github-app.ts`
     那套 GitHub App/JWT（那是给 Cloudflare Workers CI projection 用的完全不同的
     重量级流程，建一个 issue 用不上安装 token）。
   - 仓库/组织可配置：`GITHUB_ISSUE_REPO_OWNER`（默认 `boardx`）、
     `GITHUB_ISSUE_REPO_NAME`（默认 `workspacex`）。
   - **fail closed**：管理员在弹层里编辑过标题/正文/标签之后提交，心智模型是
     "这一下同时做了两件事"。issue 建失败时，状态**不落库**、契约既有的
     `DEPENDENCY_UNAVAILABLE` 冒泡给调用方（HTTP 503）——绝不允许"状态改了、
     issue 没建成"这种看起来正常、实际是假象的中间态。
   - 幂等：只在这条反馈**还没有** `github_issue_url` 时才建（迁移
     `20260830120000_fb2_feedback_github_issue.sql` 新增的两列），
     避免同一条反馈来回在 `已进入迭代` 与其他状态之间转移时重复建 issue。
   - Label 映射（写在 `notification-ports.ts` 消费处，非契约的一部分——契约只搬运
     管理员编辑之后的最终标签数组，不做映射）：`user-feedback`（恒带，标记来源）
     + `缺陷→bug` / `需求→enhancement`。管理员可以在弹层里删改，这只是默认值。

2. **任意状态转移都尽力给提交人发一封通知邮件**（"你的反馈状态变了"）。
   - 通用端口：`application/notifications/transactional-mail-ports.ts` 的
     `TransactionalMailTransport`——**不是**复用认证域的 `VerificationMailTransport`
     （ADR-104）：那个 transport 的主题/正文对"验证邮件"这一件事写死了，给不了
     任意文案。新端口只认 `{to, subject, text}`，内容由用例层拼好再传入。
   - 适配器：`infrastructure/notifications/cloudflare-transactional-email-transport.ts`
     的 `CloudflareTransactionalEmailTransport`——同一个 Cloudflare Email Sending
     REST 端点、同样的 Proxy-deferred 配置校验、生产 fail-fast / 非生产 permissive。
     复用 `CLOUDFLARE_ACCOUNT_ID` / `MAIL_FROM`（账号级配置，两套邮件功能没理由
     分别配一遍），但用**独立**的 `CLOUDFLARE_TXN_EMAIL_API_TOKEN`——与验证邮件
     token 的最小权限原则一致，各自可单独轮换/吊销。
   - **best-effort**：状态已经落库之后才尝试发信，包在 try/catch 里；失败只记
     `logger.error`（不是静默吞掉）、把 `notified` 置 `false`，**绝不**回滚状态、
     **绝不**让 HTTP 请求失败——状态转移是已经发生的事实，邮件只是"顺带告诉一声"。
   - 提交人邮箱通过新端口 `application/feedback/notification-ports.ts` 的
     `FeedbackSubmitterDirectory`（实现：`PgFeedbackSubmitterDirectory`）从
     `product_feedback.submitted_by`（= `credentials.user_id`，落库时已经是真实
     userId，不是布尔）反查 `credentials.email`。账号已注销、查不到邮箱时视为
     "没有能通知到的人"，不是错误。
   - 幂等重放（目标状态 = 当前状态）不发信——状态没变，没有新鲜事可通知。

契约层：`triageFeedback.in` 新增可空可选的 `issueDraft`（标题/正文/标签，管理员在
"转开发"弹层里编辑之后的最终文案）；`out` 新增 `notified: boolean` 与
`githubIssueUrl: string | null | undefined`。两个新增字段都是 `.strict()` 对象上的
可选/可空字段，向后兼容既有调用方（ADR-020）。

## 后果

- "转开发"从一个纯内部状态标记变成真的在 GitHub 上留下一条可追踪的 issue，
  反馈闭环第一次接上真实的开发排期系统。
- 提交人不再需要主动回后台屏才知道自己那条反馈的下落。
- 新增两个 env 依赖面（`GITHUB_ISSUE_TOKEN` 等三个 GitHub 变量、
  `CLOUDFLARE_TXN_EMAIL_API_TOKEN`），但都走 lazy 校验：任何一个没配置，只影响
  它自己被触发的那一刻（建 issue 失败 / 通知发不出去），不影响 API 进程启动、
  不影响其余分诊功能。
- 两个端口的测试都注入 fake（`GithubIssueCreator` / `TransactionalMailTransport` /
  `FeedbackSubmitterDirectory` 的假实现），不发真实网络请求——同 ADR-104 的纪律。

## 参考
- ADR-104（Cloudflare Email Service REST delivery）——本决策复用其账号级配置与
  Proxy-deferred 校验手法，但为通用邮件与 GitHub issue 各自新增独立端口/适配器。
- ADR-020（API 契约单源）——`issueDraft`/`notified`/`githubIssueUrl` 的新增方式。
- [GitHub REST API：Create an issue](https://docs.github.com/en/rest/issues/issues#create-an-issue)
