# 国际化一期实现计划

用户已明确“按计划直接开发”；按直接交办路径交付一个 #6134 PR 到 develop，不伪造 feature 或签核 status。设计依据 docs/design/i18n-foundation/README.md。

1. 先写 tests/ui/i18n.test.tsx，验证语言切换、插值原文安全、cookie持久化、非法值及存储禁用。确认缺模块红，再实现 locale/messages/provider/language-switcher。服务端 cookie 读取独立模块，layout 同源初始化，Providers 包裹全局内容。
2. 以组件行为测试覆盖首页及导航切换；将 components/home 的系统静态文案、模板和状态映射到资源，导航按 stable key翻译，保留 API 用户原文。登录入口与AuthShell同步资源，保留全部认证流程。
3. 跑 web typecheck、lint、相关 i18n/home/shell/auth tests，浏览器验证切换、刷新和窄屏，按实际输出记录边界。缺测试环境不能当通过。
4. 更新一期文档与issue证据，commit/push/PR（Closes #6134、base develop），跟进CI。二期资源按namespace独立文件，通过统一registry聚合；等待一期合入后接入。
