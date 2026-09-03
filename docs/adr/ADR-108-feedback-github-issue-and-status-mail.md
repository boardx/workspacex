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
   - **`GITHUB_ISSUE_TOKEN` 的最小权限范围**（二轮独立审查追问，2026-08-31）：
     这个 token 只需要对 `GITHUB_ISSUE_REPO_OWNER/GITHUB_ISSUE_REPO_NAME`
     这一个仓库的 **Issues: Write**（fine-grained PAT）——不需要 `repo`（整仓库
     读写）这种更宽的经典 scope，更不需要任何其他仓库或组织级权限。经典 PAT
     没有仓库粒度的 scope，只能选到 `public_repo`（公开仓库）；本仓库若非公开，
     换成 fine-grained PAT 才能真正做到"只对这一个仓库、只有 Issues 写权限"。
     这是**部署时**的配置纪律（谁去 GitHub 生成这个 token、勾哪些权限），代码
     这一侧没有、也不可能有一个机制去校验"外部签发的 token 实际持有的权限集合
     确实是最小的"——那要求反向调用 GitHub 的 token introspection API，为一个
     部署配置问题在运行时加一次额外的外部依赖并不成比例。真正的机械保证在于
     `FetchGithubIssueCreator` 本身：它只拼得出**建 issue**这一个请求，代码里
     没有第二条能打到 GitHub 的路径，所以就算 token 权限给宽了，本仓库这一侧
     的代码也用不上那多出来的权限——最小化暴露面是"这段代码能做什么"，不是
     "这个 token 理论上能做什么"。

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

## 追补（2026-08-31，二轮独立审查阻断项①）：并发/崩溃安全

原始设计的"建 issue 前先判断 `githubIssueUrl === null`"不是原子的：两个并发的
"转开发"请求可能都读到 `null`，各自建一个 issue；或者 GitHub 调用成功、写回
之前进程崩溃，issue 建出来了但库里不知道，下次重试再建一个。

迁移 `20260831010000_fb2_feedback_github_issue_claim.sql` 加了
`github_issue_claimed_at` 一列，`triageFeedback` 在真正调 GitHub 之前先
`ProductFeedbackRepository.claimGithubIssueCreation` 原子认领一次（单条
`UPDATE ... WHERE github_issue_url IS NULL AND (claimed_at IS NULL OR 已过期) RETURNING`，
互斥性由 Postgres 对同一行的并发 UPDATE 保证，不需要应用层加锁）；认领失败
（另一个请求正在办或已经办完）直接抛新的 `FeedbackIssueInProgressError`（HTTP
409 `ISSUE_CREATION_IN_PROGRESS`），不悄悄跳过、不假装成功。认领成功后建
失败会显式 `releaseGithubIssueClaim` 释放，不必等 5 分钟的过期窗口。

**如实记录这一步没有解决什么**：GitHub 的 issue 创建接口没有幂等键，"外部
调用已经成功、本地写回之前进程崩溃"这个窗口仍然存在，只是被 claim 缩小到
了"决定要建"与"写回成功"之间那一小段（而不是整个"判断 + 调用 + 写回"三步）。
真要彻底关上这个窗口需要一个能反查"这条反馈是否已经在 GitHub 建过 issue"的
读端点（按标题/来源标记搜索），属于超出这次修复范围的另一轮工作量。

## 追补（2026-09-03，反馈附件图片功能上线后发现）：`GITHUB_ISSUE_TOKEN` 最小权限指引已过期

上面「`GITHUB_ISSUE_TOKEN` 的最小权限范围」那条（40-53 行，2026-08-31 写）说
"代码里没有第二条能打到 GitHub 的路径,所以只需要 Issues: Write"——这句话在
`infrastructure/feedback/github-issue-creator.ts` 的 `uploadImage`/
`ensureAttachmentsBranch`（随反馈附件图片功能新增,见 `notification-ports.ts`
`GithubIssueImageUploader` 头注的 2026-09-03 人类决策)加进来之后**已经不成立**：
现在确实有了第二条路径——Git Data API（`git/ref` → `git/trees` → `git/commits`
→ `git/refs`,惰性建 `feedback-attachments` 孤儿分支）+ Contents API
（`PUT contents/<path>`),把反馈附件图片推进仓库、换一个 `raw.githubusercontent.com`
直链拼进 issue 正文。这条路径需要 **Contents: Write**（fine-grained PAT）,
建 issue 用的 **Issues: Write** 覆盖不到它。

**实测症状**：按本 ADR 原有指引配的 token（只勾 Issues: Write）——issue 照样建得出来
（`create` 那条路径完全不受影响),但 `uploadImage` 在 Git Data / Contents API 上
稳定拿 403,被 `triageFeedback` 的 best-effort 逻辑吞掉,只落一条
`traceId: "feedback-triage-attachment-image"` 的 error 日志——**没有任何用户可见的
报错**,表现就是"反馈带了图、issue 建出来了、图片从来没出现过",很容易被误判成
"代码没生效",实际是部署时的 token 权限没跟着功能一起升级。

**修复**（部署侧,代码这一侧不需要跟着改——同原有指引"这是部署时的配置纪律"那条
道理)：
- 去 GitHub 给这个 token 补上对 `GITHUB_ISSUE_REPO_OWNER/GITHUB_ISSUE_REPO_NAME`
  这一个仓库的 **Contents: Write**（fine-grained PAT,与已有的 Issues: Write 并列勾）；
  经典 PAT 且仓库公开时,`public_repo` 这一个 scope 本身已经同时覆盖 Issues 与
  Contents,不需要额外动作。
- 上线前/怀疑权限不对时,用
  `apps/api/scripts/probe-github-issue-token.mjs` 实测——它复现的是 `uploadImage`
  真实会发的同一串请求,不是猜测；跑一次就知道当前 token 到底能不能推图片,不用
  等一次真实反馈分诊、翻日志才发现。

原有「最小权限」的精神（不多给用不上的权限)没有变,只是"用不上"这件事本身
随图片功能的加入而变了——这条追补更新的是**范围**,不是推翻那条原则。

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
- 契约新增错误码 `ISSUE_CREATION_IN_PROGRESS`（409），与既有的
  `DEPENDENCY_UNAVAILABLE`（503）区分"这是并发冲突"与"下游依赖不可用"两种
  性质不同的失败——调用方对二者的合理反应不一样（前者提示刷新，后者提示重试）。

## 参考
- ADR-104（Cloudflare Email Service REST delivery）——本决策复用其账号级配置与
  Proxy-deferred 校验手法，但为通用邮件与 GitHub issue 各自新增独立端口/适配器。
- ADR-020（API 契约单源）——`issueDraft`/`notified`/`githubIssueUrl` 的新增方式。
- [GitHub REST API：Create an issue](https://docs.github.com/en/rest/issues/issues#create-an-issue)
