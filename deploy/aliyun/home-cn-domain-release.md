# 中国营销主域与登录入口修复 — 2026-10-30

本文件取代 `home-cn-icp-release.md` 中的未来主域/备案号方案；旧文和历史版本保留。
用户已确认主域 `workspacex.cn`、页脚 `粤ICP备2021115740号-2`、旧域 `/login` 修复，
并明确授权修复后直接发布、测试。追踪：<https://github.com/boardx/workspacex/issues/6013>。

## 当前交付边界

**代码及相关本地测试已完成，尚未发布。** 此云环境的实时 readiness 回执显示：
无 secrets、runtime variables、outbound identities；没有阿里云/ESA CLI 及现有登录配置。
未申请或创建新 token，未调用发布或 DNS 写接口，因此没有发布版本/发布 RequestId。
未调整美国站、应用后端、数据库、收费、安全配置，也未删除任何历史版本。
仓库 `./init.sh` 快速路径最终通过（pnpm 9.15、继承会话代理）。可选 canvas 构建报缺 `pixman-1`，
运行时 Node 24 高于仓库声明的 22；未运行 `--full` 全仓验证。harness tick 因缺 COORD_GATEWAY_URL 失败，
readiness 已运行。未为独立营销任务新建调度循环。

## 2026-10-30 02:44 UTC 公网前置核查

原始脱敏回执：`evidence/home-domain-20261030/public-before.json`。
HTTPS curl 保持证书校验，跟随最多 8 次跳转，保存状态链及正文 SHA-256，不保存 Cookie。

| 地址 | 实测 |
| --- | --- |
| `https://workspacex.cn/` | 302 → `https://www.boardx.com.cn/login` → 404 |
| `https://boardx.com.cn/`、`/login` | 302 → 同上 → 404 |
| `https://www.boardx.com.cn/` | 200、中文、备案号 `-1`，有工信部链接 |
| `https://www.boardx.com.cn/login` | 404 |
| `https://app.boardx.com.cn/login` | 200、真实 Next.js 登录页面 |
| `https://workspacex.us/`、`/zh/` | 200、无备案号 |

Google 公共 DNS A 查询：`workspacex.cn`、`boardx.com.cn` 都为 `47.116.120.18`，TTL 600；
`www.boardx.com.cn` CNAME `www.boardx.com.cn.a2.initjj.com.`，TTL 600；
应用 A 为 `101.132.151.28`。公共 DNS 不等同于阿里云账号内记录 ID/配置快照。
公开发布标记：commit `4f7ac1b868a0996807fc32bdb0d011f1544fc777`、origin 为旧 www 域、备案号 `-1`。
该 SHA 不在云端对象库，按 SHA 从 origin fetch 返回 `not our ref`；不可假定现分支与线上字节相同。
历史生产版本 `1793182357164195675` 仅来自交接，当前 provider version 和绑定未能认证读取。

## 最小源码修改

- 仅修改 CN 打包器、配置和对应测试；`apps/home` 美国源文件及部署工作流未改。
- 中国 canonical、社交 URL、robots、sitemap、发布标记使用 `https://workspacex.cn`。
- 默认中文，保留显式 `/en/`、`/zh/`；所有中国 HTML 页脚静态注入精确 `-2` 和工信部链接。
- `/login`、`/login/` 提供实际静态 HTML，JavaScript 用 `location.replace` 直接进入已核实中国应用，
  保留 query/hash；关闭 JS 时通过 noscript refresh 进入登录页，并有可见手动链接。
  无 JS 静态 fallback 不保留 query/hash；边缘 HTTP 跳转应保留 query。
- 同时生成 `_redirects` 规则。ESA 未实测支持该 Cloudflare 文件，故不依赖它作为唯一修复。
- 配置声明两个旧域兼容跳向新主域并保留路径/query；这是待执行的目标，**不是已生效的域名绑定**。
- `filingVerification` 标记用户确认编号、接入商覆盖未核实，没有伪造官方验证状态。

## 相关验证

`unit.log`：11 项 Python 测试通过。`static.log`：16 项静态检查通过。
`pages-tests.log`：25 项 Pages 测试通过。`browser.log`：128 项 Chromium 检查通过，
320/390/768/1440px、JS 开/关、CN/US、中文默认、44px 备案链接、无新增页脚溢出、登录无营销站循环。
登录浏览器测试拦截已核实应用目的地，证明本地导航正确，未登录或更改应用数据。
中国打包前后 US 包文件哈希完全一致；390px 无 JS 页脚截图已保存并人工查看。

## 认证恢复后的发布与回退步骤

1. 提供此云环境对现有阿里云账号的授权连接/既有 ESA OAuth，不新建 token。
   只读查询现有 `workspacex-home-cn` 当前绑定、生产版本、Available 版本、版本额度，
   两个根域的 DNS 记录 ID/值/TTL、证书和接入商对 `workspacex.cn` 的覆盖状态。
   保存可恢复的配置快照；不能使用本文件历史版本代替实时结果。
2. 核实发布输入与当前生产源码差异；用精确提交构建 US 基础包和独立 CN 包，保存制品 SHA-256。
   使用既有静态上传/commit/deploy 流程，只操作 `workspacex-home-cn`。
   额度不足时停下，不能删除历史版本或擅自切换收费。
3. 使用现有免费能力绑定 `workspacex.cn`、保证有效 TLS，按平台实际返回的接入目标修改必要 DNS。
   新目标尚未知，禁止猜测 CNAME 或直接改为应用 IP。
   旧域先匹配 `/login` 和 `/login/` 直接 302 到中国应用，再将其余路径 301/308 到新主域、保留 query。
   新主域不得跳回旧域；若已有规则/绑定属于共享应用，先确认仅营销范围可改。
4. 发布后实时记录 commit、版本 ID、请求 ID、UTC 时间、制品 SHA-256。
   验证新主域/旧域首页与 `/login`、HTTPS、跳转链无循环、中文默认、精确备案文本及工信部链接、手机；
   再读美国首页/中文/隐私/手册无备案号且与前置指纹比较。
5. 验收失败先排除并发发布，将 production 切回步骤 1 实时记录的 Available 旧版本，
   恢复步骤 1 的 DNS/绑定/路由快照。保留所有旧版本，不执行清理。

官方 ESA 跳转参考：<https://help.aliyun.com/en/edge-security-acceleration/dcdn/user-guide/redirect-to-a-specified-url>。
