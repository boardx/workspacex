# 国际化一期：基础与产品首页（待人类签核）

本文件是设计提案，不是已批准的契约或完成证据。用户已选定分阶段国际化方向；下面的具体客户端契约仍需签核。二期子页面、三期数据库迁移依序接入。

## 真实入口与范围

基线 origin/develop：151526a4f8dea1ad781d709ab8e3357f52714a96。main 已 fetch，开发以 PROJECT.md 规定的 develop 为基线，PR 目标 develop。

- `apps/web/app/page.tsx` 的 `/` 直接 redirect(`/login`)；登录入口位于 `app/(entry)/login/page.tsx`，有效会话进入 `/home`。
- 产品首页 `app/home/page.tsx` 使用 AppShell + HomeScreen；首页 hideTopBar，语言入口不能仅放 TopBar。
- 一期包含 Providers、html lang、语言入口、登录入口、HomeScreen/HomeBanner/HomeSections/HomeWorkCards，以及共享导航的 label、分组、tooltip、aria、个人菜单、移动导航、壳层固定状态。
- `lib/navigation.ts` 是路由及权限过滤的事实源。保持 key/href/icon 和权限行为，通过稳定 key 解析展示翻译。
- 首页横幅、组织名称、推荐 Agent/Skill 名称和简介来自 HomeConfig API；组织管理员自填值、用户姓名和项目标题按原文展示。必须逐项区分系统默认值和用户自填值，不能按“等于中文默认串”猜来源。无法判别来源的 API 内容维持原文并记录边界，第三期处理展示本地化。
- 不覆盖 apps/home 官网，不改变登录重定向、token、组织权限或 Agent 执行指令。

## 方案与选择依据

建议应用内类型安全资源 + React Provider；本期没有语言 URL/SEO 需求，保持当前路由与 returnTo 语义。另一可行方案是 next-intl + locale 路由/中间件，但会扩大入口与认证改动，留到确有语言 URL 需求时评估。不采用 DOM 自动替换或运行时机器翻译：难以区别用户原文，也无法稳定覆盖 aria 和错误状态。

下面为实现建议，尚未冒称用户已选定库和具体接口。

## ① UI

支持 `zh-CN`、`en`，默认 `zh-CN`。登录入口和共享壳均有可键盘操作的原生语言选择器，选项自称“简体中文 / English”。桌面侧栏和移动端均可用，首页隐藏顶栏时仍可见，不创建第二套全局导航。

切换立即更新本期系统文案及 html lang，不重载页面，不丢失表单和会话。刷新、跨路由和新标签页保留选择。存储不可用时当前页面仍可切换。长英文在 375/768/1280 宽度不遮住按钮或产生横向溢出。图标本身不翻译，tooltip/可访问名称同步切换。

新增入口的真实组件截图与一致性复核尚未生成，不具备设计签核材料完成条件。

## ② 用例与失败模式

1. 首次访问无 locale cookie：默认中文；SSR 文案、Provider 初值与 html lang 一致。
2. 用户选择 English：即时更新并写入同源非敏感 cookie（Path=/、SameSite=Lax，HTTPS 时 Secure，一年有效）；cookie 是持久化单源，避免 cookie/localStorage 双写漂移。
3. SSR layout 严格校验 cookie，只接受支持值；非法/未知值回退中文，不将外部字符串插入脚本或 HTML。
4. 新标签页从 cookie 初始化；已打开标签页通过 BroadcastChannel 广播切换（不支持时保留各标签页当前状态，刷新后收敛）；不把会话凭据放入广播。
5. cookie 被禁用：Provider 保持内存语言；刷新恢复默认，不影响登录。
6. 缺英文资源：开发与 CI 完整性检查失败；运行时回退中文资源，不展示 undefined。用户内容回退仍为源语言，不等价于中文。
7. 模板插值作为 React 文本渲染，姓名中的 HTML 不执行；日期/数字用 Intl 与当前 locale，保持业务时区规则。
8. 服务端错误优先按稳定 reason code 映射 UI copy，未知错误用本地化通用信息并保留既有诊断，不直接翻译用户文本或解析中文错误字符串。

## ③ 客户端/API 契约

一期不新增数据库字段或 API 端点，不宣称后端已支持 Accept-Language。三期按签核后的 API 契约接入同一个 locale 值，并将 locale 纳入翻译数据缓存 key。

建议待实现的接口：

- `apps/web/lib/i18n/locale.ts`：`SUPPORTED_LOCALES`、`Locale`、`DEFAULT_LOCALE`、cookie 名、严格解析函数；常量单源。
- `apps/web/lib/i18n/messages/{zh-CN,en}.ts`：按 common/navigation/home/auth 域组织字典；英文结构以中文源资源的类型为约束。二期新增域文件须在同一注册表注册，两种语言完整性机械核对。
- `apps/web/lib/i18n/provider.tsx`：`useI18n()` 返回 `{ locale, setLocale, t }`，有明确的类型化插值参数；测试也使用真实 Provider，不静默绕过缺失 Provider。
- `apps/web/lib/i18n/server.ts`：仅服务端读 cookie，返回受限 Locale；RSC 使用纯资源读取函数，不能调用 React 客户端 hook。
- `RootLayout` 将解析后的 locale 同时传给 html lang 和 Providers。错误边界/全局错误页不假设 Provider 一定存在，使用已验证 locale 与纯资源读取函数兜底。
- navigation 翻译按稳定 key 选择，不改变 route/permission 数据，也不通过中文展示名作翻译 key。

## 验收与交付

实现前建立行为测试：cookie 初值/非法值/写入失败、缺译检测、插值安全、Provider 切换与广播。浏览器验证 `/ → /login → /home`、刷新、跨路由、移动入口、tooltip/aria、英文布局及用户原文保持。保留现有首页、认证和 shell 回归。

拟执行 `pnpm --filter web typecheck`、`pnpm --filter web lint`、新建的 i18n Vitest 与 Playwright spec，以及现有相关 home/shell/auth 测试。具体 spec 文件在实现前确定；上述目前未执行，不能当作通过证据。

依照根 AGENTS.md，正式 feature 开工还需契约束 design-signoff.md 三节的人类签核和阶段一致性复核。本提案不改任何签核 status。

## 当前阻塞与恢复点

- 共享原 checkout 的 `./init.sh` 快速路径成功（不是全仓验证）。独立实现 worktree 尚未 init。
- `pnpm harness readiness` 已运行；队列外原因：用户直接交办国际化，优先准备一期依赖基础。
- `pnpm harness tick` 失败：COORD_GATEWAY_URL 未配置。缓存凭据文件存在，但没有获配本任务注册身份，不自封身份或读取输出凭据。需提供本任务已注册 worker id 和网关接线方式。
- 未找到本次国际化已确认的契约束，尚未写产品代码、创建 feature 或宣称 passing。
- 独立 worktree `/Users/shenyangjun/boardx/workspacex-i18n-foundation`，分支 `worker/i18n-foundation`；共享 checkout 保持原分支。原生创建工具未识别源仓库后使用 git worktree fallback，仅创建一次成功 worktree。后续复用此目录。

## 2026-11-03 授权后实现增量

主会话转达人类明确“按计划直接开发”，按直接交办流程实现，不创建/伪造 feature passing 或人类 signoff。本分支已接入locale cookie、SSR Provider、语言入口、登录品牌/表单系统文案、首页静态标题/状态/卡片/时间、桌面与移动导航及个人/组织菜单。实际差异以PR为准。

落地接口遵循上文路径；为兼容既有独立组件与测试，未装Provider的孤立组件使用默认中文上下文（正式app总有Provider）。这是一处相对提案的实现调整，二期测试多语言行为时必须包真实I18nProvider，不得把默认中文当英文通过。

二期资源接入：独立namespace导出 `profileZhCN/profileEn` 等，在 messages/zh-CN.ts 与 messages/en.ts 导入并展开。MessageKey自动来自合并后的中文字典，英文Record保持完整；`t(key, params?)`使用一次文本插值，不渲染HTML。服务端用server.ts的readLocale，纯读取用messages.ts的translate；不要从RSC调用useI18n。

剩余领域文案：本地版能力/出网事实、通知弹层、通用StateShell等由二期按其稳定ID/状态逐项接入。HomeConfig动态展示原文与Agent/Skill执行内容继续保持分离。完整已登录首页真实数据E2E未在本地验收，不冒称已完成全站英文化。
