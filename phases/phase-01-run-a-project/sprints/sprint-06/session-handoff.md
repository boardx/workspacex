# 会话交接 — Sprint 01/06

## 当前已验证
- F174 仍为 `in_progress`；本地实现与逐屏 QA 已完成，等待完整验证与 GitHub 审计链后由 harness 转 passing。

## 本轮改动
- 修复 `/research` 的引导式入口激活态、六屏布局契约锚点、浏览器到 API 的 research 同源代理与导航 UC-24.6 投影。
- 新增视觉契约测试、rewrite 反证测试和六屏并排截图证据。
- 创建入口现先弹出研究命名与可选标签；确认后进入 brief，最终创建时由 API 与数据库持久化，并在历史卡片恢复。
- 修复引导式入口继续传 `mockIdentity` 导致真实会话 401 仍渲染假登录壳的问题；引导式入口现使用 `SessionProvider`，失效会话跳转 `/login`，旧 `?screen=…` 预览不变。

## 仍损坏或未验证
- GitHub issue 尚未创建；禁止在无 issue/PR 的情况下声称完成。
- 创建元数据的隔离 API 集成测试与真实浏览器链路均已通过；完整 feature/harness 验证仍待 GitHub issue 审计链补齐后执行。
- F170/F171 仍负责真实 Web Search 执行与真实报告数据，本 feature 仅保护现有已签 UI 和入口链路。

## 下一步最佳动作
- 先补 F174 GitHub issue，再跑 feature verification、提交、review、PR；不要把 F170/F171 偷并到 F174。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/06`
- 调试:`NEXT_PUBLIC_API_URL=http://localhost:3074 NEXT_PUBLIC_API_PATH_PREFIX=/__fullstack_api FULLSTACK_E2E_API_ORIGIN=http://127.0.0.1:3274 pnpm --filter web exec next dev -p 3074`
