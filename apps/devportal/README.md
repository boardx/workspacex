# devportal — Developer Portal @ develop.boardx.us（协作平面）

> 迁移来源：`boardx/boardx-dev-template@e4cf8c612708a8168d54e6d9d3a8e002ad925761:apps/devportal`。
> 自 #450 起，源码、CI/CD 与运行配置的唯一维护仓库是 `boardx/workspacex`；
> 旧仓只在新生产链验证完成后由独立 issue 停用，避免双重部署窗口。

Developer Portal 的 Cloudflare 原生部署。**自包含项目**：
零跨目录 import、零内部包依赖；与 `apps/web` 的产品面 portal 是有意的双份
（数据源/门禁不同，共享代码会把两平面重新缠住，见 ADR-013 姊妹决策 #523）。

- 数据：GitHub Contents API（phases/registry）+ coord-gateway RepoHub 读面（claims/events，ADR-017）+ GitHub REST
- 协调状态：只通过 `COORD_GATEWAY_URL` 访问 WorkSpaceX 的 PlatformDirectory / RepoHub；
  DevPortal 不创建 D1、Postgres、Hyperdrive 或自己的 Durable Object。也就是说它和
  coord-gateway 共享的是**同一权威数据面**，不是复制一份数据库。
- 门禁：Cloudflare Access（GitHub 登录），`lib/access.ts` 对 `Cf-Access-Jwt-Assertion`
  验签（团队证书端点）；**pages.dev 直连无 Access 上下文 → API 一律 401**

## 部署

配置的唯一事实源 = 本目录 `wrangler.toml`（nodejs_compat、非敏感 vars）。

**日常**：PR 触碰 `apps/devportal/**` 时先跑 typecheck / lint / test / Pages build；
合并到 WorkSpaceX `main` 后，CI `deploy-devportal.yml` 才部署到既有 Cloudflare Pages
项目 `devportal`（构建链 `next build` → `@cloudflare/next-on-pages` → `wrangler pages deploy`）。

**首次/新环境复现**：
```bash
pnpm install
cd apps/devportal
npx wrangler pages project create devportal --production-branch main   # 仅首次
pnpm exec wrangler pages secret put GITHUB_TOKEN --project-name devportal  # 细粒度只读 PAT
pnpm build && pnpm exec next-on-pages
pnpm exec wrangler pages deploy .vercel/output/static --branch main
# 域名绑定（仅首次）：Pages → devportal → Custom domains → develop.boardx.us
# Access 应用作用于该主机名，换绑项目不影响门禁
```

**冒烟标准**（CI 已内置断言）：`develop.boardx.us` → 302（Access 门禁在前）；
`*.pages.dev` 直连 API → 401（验签拒绝无凭据请求）。

## Access aud 校验

`CF_ACCESS_AUD` 配置后 JWT 验证将同时校验 audience（防团队域下多 Access 应用互通）。
aud tag 在 Zero Trust dashboard 的应用详情页；当前部署 API token 无 Access 读权限，
待人类提供后在 wrangler.toml 取消注释即启用，无需改代码。未配置时仅验 issuer+签名，
`lib/access.ts` 每进程输出一次 `console.warn` 提醒（不阻断部署——向后兼容策略，#769）。

## 会话运维（#769）

- OAuth session cookie（`__Host-devportal_session`）TTL 24h，活跃用户在剩余寿命
  < 12h 时由 middleware 静默续期（重签并 Set-Cookie），不会中途掉线。
- **紧急全员登出**：轮换 `SESSION_SECRET`（`wrangler pages secret put SESSION_SECRET
  --project-name devportal` 换新随机串）会让所有已签发 session JWT 验签失败，是当前
  唯一现成的服务端吊销手段（无 session 黑名单/撤销列表）。代价：全员（含 Access 回退
  通道之外的 OAuth 登录用户）需重新走一次 GitHub OAuth；Access JWT 回退通道不受影响
  （生命周期由 Cloudflare Access 自己管，不吃 SESSION_SECRET）。
