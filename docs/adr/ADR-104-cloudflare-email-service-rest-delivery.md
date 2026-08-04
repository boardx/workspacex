# ADR-104: Cloudflare Email Service REST delivery

- 状态: Accepted
- 适用层：项目实现（专属）
- 日期: 2026-08-04

## 背景
`apps/api` 是 PostgreSQL-backed Node 服务。邮箱验证必须与注册事务一起可靠入队，
但外部邮件调用不能进入注册事务；把认证迁入 Worker 又会拆散现有身份边界。验证链接是
敏感 bearer，因此数据库不得保存明文 challenge，生产也不得启用 Email Preview。

## 决策
在 `apps/api` 保留 PostgreSQL transactional outbox，由独立 outbox worker 调用 Cloudflare
account Email Sending REST API。适配器只接受显式的 `CLOUDFLARE_ACCOUNT_ID`、
`CLOUDFLARE_EMAIL_API_TOKEN`、`MAIL_FROM` 与 `APP_PUBLIC_URL`；生产缺任一配置即拒绝启动，
token 仅授予 Email Sending: Edit。迁移期间，非生产环境在专用 token 未配置时可回退到现有
`CLOUDFLARE_API_TOKEN`，但只要两者同时存在就优先专用 token；生产不接受通用 token 回退，
部署前必须换成最小权限的 `CLOUDFLARE_EMAIL_API_TOKEN`。测试注入 fake transport，不调用真实服务。

当前已启用的发送域是 `mail.boardx.us`，公开 MX/SPF/DKIM/DMARC 已生效；发件人为
`no-reply@mail.boardx.us`，return path 为 `cf-bounce.mail.boardx.us`。这些是部署配置事实，
不改变适配器的 API 语义，也不把 token 写入仓库。

验证 bearer 由服务端 secret 和随机 challenge id 派生；库中 challenge 表只保存 bearer
digest，outbox 只保存 challenge id、收件人与模板。worker 投递时才重建链接。每次调用携带稳定
`X-WorkspaceX-Outbox-ID` 供追踪（Cloudflare 禁止客户端设置其平台控制的 `Message-ID`），成功后
保存 Cloudflare 返回的真实 `result.message_id`。HTTP 成功、响应 `success=true`、合法
`result.message_id` 且收件人未出现在 `permanent_bounces` 即视为供应商已接受；`delivered` / `queued`
数组为空不否定接受结果。数据库 claim/完成状态保证已确认成功的 outbox 不会重投，永久退信进入
不可重试终态，其余失败按分类记录并重试；请求有硬超时，避免单实例队列永久停摆。

Email Preview 是 Cloudflare sending subdomain 的服务端状态，目前 provider 侧仍为 enabled，且
官方 API 没有更新该设置的端点。部署者必须在 Dashboard 中关闭 Preview，核验
`preview_enabled=false` 后才能提供 `CLOUDFLARE_EMAIL_PREVIEW_DISABLED=true` 作为可审计
attestation；生产缺此声明即拒绝启动。应用不声称自行切换或远程读取 Preview 状态。

## 后果
- 注册提交与邮件供应商故障解耦，失败可观测、可重试；认证与数据仍留在 Node/PostgreSQL。
- REST adapter 是窄 egress seam，凭据可以最小授权且测试无需网络。
- 相比 Worker binding，多一次 HTTP 跳转并需维护轮询 worker；相比事务内发送，换来一致的
  outbox 语义。Cloudflare REST 没有业务级 exactly-once / idempotency-key 承诺，因此 outbox
  identity 能防止已确认成功后的本地重复处理，却不能消除「供应商已接收但响应超时」这一
  不可判定窗口；稳定 X-header 仅提供跨系统追踪，不被误写成供应商去重保证。

## 参考
- [Cloudflare Email Service REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)
- [Cloudflare Email headers](https://developers.cloudflare.com/email-service/reference/headers/)
- [Cloudflare Email Sending subdomain state](https://developers.cloudflare.com/api/resources/email_sending/)
