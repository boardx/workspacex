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
token 仅授予 Email Sending: Edit。测试注入 fake transport，不调用真实服务。

验证 bearer 由服务端 secret 和随机 challenge id 派生；库中 challenge 表只保存 bearer
digest，outbox 只保存 challenge id、收件人与模板。worker 投递时才重建链接。每个 outbox id
产生稳定 Message-ID；数据库 claim/完成状态保证并发 worker 只处理一份，失败按分类记录并重试。
生产配置强制 Email Preview 关闭。

## 后果
- 注册提交与邮件供应商故障解耦，失败可观测、可重试；认证与数据仍留在 Node/PostgreSQL。
- REST adapter 是窄 egress seam，凭据可以最小授权且测试无需网络。
- 相比 Worker binding，多一次 HTTP 跳转并需维护轮询 worker；相比事务内发送，换来一致的
  outbox 语义。Cloudflare 不提供业务级 exactly-once 承诺，因此稳定 Message-ID 与 outbox
  identity 只能把重放做成幂等请求；网络超时后的供应商侧最终去重仍依赖其邮件管线。
