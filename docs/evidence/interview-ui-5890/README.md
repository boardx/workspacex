# 用户访谈 UI 修复 #5890

人类已在聊天中批准设计及四项范围。产品实现 SHA：`fa90116ae14cccd00d12e9a2ca31002f711b9755`；基线 `15fa02b7df830d607d94432e60dd45cbad169dc9`。

- 导入需求：单一圆角编辑器、统一聚焦边框、工具栏与格式提示；保留上传/语音和草稿恢复。
- 访谈问题：正文只保留一处生成状态；步骤条与页尾不重复旋转；生成中不显示“请先生成”空态，旧问题仍保留。
- 访谈答案：默认收起；展开/收起按钮支持键盘、aria-expanded/controls；选专家展开该专家，返回全部时收起；源文档和来源不变。
- 切换步骤：当前访谈 layout 内保留 canonical 完成投影；初次未知状态不画成未完成；失败重试；新修订按实际状态清除下游完成，身份/组织/token变化清空路由状态。

## 验证

- 先红后绿：`red-tests.txt`（3 个行为失败）、`red-navigation.txt`（2 个导航状态失败）。
- `pnpm --filter web exec vitest run tests/ui/interview`：26 文件，254 测试通过，见 `interview-suite.txt`。
- `pnpm --filter web typecheck`：退出 0，见 `typecheck.txt`。
- 受影响组件 Next ESLint：无警告错误，见 `eslint.txt`。
- `pnpm --filter web lint:design`：通过，见 `design-lint.txt`。
- `./init.sh`：快速路径退出 0（未跑全仓 full），见 `init-quick.txt`。
- 独立源码 review：无确认 P1/P2，见 `source-review.md`。
- 原有真实浏览器回归补齐显式展开：刷新恢复、报告流式生成、失败修复共 3/3 通过（6.2s），见 `browser-legacy-tests.txt`。这次追加只修改 E2E 测试，不改产品实现。
- 真实 Chromium + 本地 Next，375/768/1280 宽度：见 `browser-report.md`、`browser-results.json` 和截图。HTTP/session 使用可控夹具；**不代表真实登录、DB或模型链路验收**。

## 资源与交接

复用现有 worktree/分支 `codex/interview-ui-polish-1023`，没有改 feature 状态或自行合并。PR 创建后由本会话跟进 CI 至权威判定绿，再交主会话处理合并。

协调服务缺失配置，tick 与 module-lock-status 无法核验身份/租约；未伪造认证、未抢占或续租。此次开发来自人类直接交办。见 `coord-status.txt`。
