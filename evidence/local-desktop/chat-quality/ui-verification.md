# 本地版界面取证（2026-09-22 03:41–03:55，真浏览器，非 mock）

十轮交付里唯一的已知缺口是「界面那层没取证」。并行会话跑完评测、机器空下来之后补上。

## 怎么跑的
- web：我的工作树 `apps/web` 起 `next dev -p 3312`，env `WORKSPACEX_EDITION=local`、
  `NEXT_PUBLIC_API_URL=http://127.0.0.1:3312` + `CHAT_READ_E2E_API_ORIGIN=http://127.0.0.1:3201`
  （走同源代理绕开 API 的 CORS allowlist——直连 3201 会被拦，症状是「身份服务暂时不可用」）。
- API / 库 / 模型：复用并行会话那套已在跑的本地栈（api 3201 / pg 55433）。刻意不另起一套
  Ollama，理由是评测须空闲机器。
- 登录：向本机 API 换一个 session，注入 `localStorage`（`wsx.session` / `wsx.sessionToken` /
  `wsx.sessionCommit`）。
- 截图：Playwright（chromium，1440×900 与 430×860），脚本与断言输出见下。

## 实测结果
| 判据 | 实测 |
|---|---|
| `<html data-edition>` | `local`（服务端请求时读出，不是 `NEXT_PUBLIC_*` 内联） |
| 顶部标识条文案 | 本地版 ｜ 模型与数据都在这台电脑上；只有你让它读网页或搜索时才会出网 ｜ 与在线版有 8 项能力不同 ｜ 切到在线正式系统 |
| 能力差异条数 | 8（= `capabilitiesMissingIn("local")`，矩阵 11 条里本地弱于在线的那些） |
| 出网事实条数 | 3（永远不出网 / 只在你明确要求时 / 被挡住） |
| 切换对话框 | 4 条代价全渲染；**确认按钮 0 个**（这份部署没配在线地址 ⇒ 走「如实说」那一支） |
| 窄屏 430px | 标识条**仍然可见**（改动前那条本地提示是 `hidden lg:block`，笔记本以下整条不渲染） |

截图：`shots/01-chat-local-banner.png`、`02-egress-facts-and-capability-gaps.png`、
`03-switch-to-cloud-dialog.png`、`03b-switch-dialog-cropped.png`、`04-banner-at-phone-width.png`。

## 取证当场发现并修掉的两件事

### 1. 白字白底（我自己写的）
切换对话框里「这份安装包还没配在线地址」那段用了裸的 `text-warning-foreground`，
**没有背景**。而 `--warning-foreground` 在浅色主题里是 `0 0% 100%`——纯白。实测：

    修前：color rgb(255,255,255) / 背景 rgb(255,255,255) ⇒ 对比 ≈ 1.0（看不见）
    修后：color rgb(126,75,27) / 背景 rgb(250,241,229) ⇒ 对比 6.45:1

⚠ 它能活下来有两条原因，都实测过：**深色主题下同一个 token 是近黑色**，所以在深色下
完全正常；而**所有几何判据都说它可见**——Playwright `isVisible()` 为真、
`getBoundingClientRect` 给出 373×48、`elementFromPoint` 返回它自己。对比度不在它们的判据里。
我的单测同样只断言了「这段文字存在且内容正确」。

全仓另有 **31 处**同形态用法（六个白色前景家族），其中混着真缺陷与「父级提供实心底」
的合法用法。我没有逐一分辨，所以**没有**把它做成门控的豁免表——一份没分辨过的清单做成
「已知例外」比没有门控更糟。先留探测器
`apps/web/scripts/detect-solid-foreground-without-fill.sh`（退出恒 0，只打印清单），
分辨完再按 U12 的豁免表先例接进 `lint-design.sh`。

### 2. 我先前一条断言是错的：个人本地组织**存在**
我说过「桌面版 provision 建的是普通 organization，personal-local 组织根本没启用」。
向本机 API 要 `GET /identity/local-org` 拿到 **200**：
`org-local-88ced53c…`、kind `personal-local`、memberCount 1、canInvite false ——
注册路径在同一个事务里就建好了它。

我犯了两个错，都记在契约注释里：① 从 `provision-admin.ts` 的**代码**推断「没有」，
而没有问运行中的系统；② 去查库时读到「只有一行」就以为证实了——`organizations` 表的
`relforcerowsecurity` 为真，连 `postgres` 都被 RLS 过滤，那个计数从来不是权威。

真正成立的说法是**作用域**：桌面版默认进入的是普通组织「我的本地工作区」，聊天发生在
它里面，所以 org 级出站守卫对默认工作区不生效——而不是「那个组织不存在」。
