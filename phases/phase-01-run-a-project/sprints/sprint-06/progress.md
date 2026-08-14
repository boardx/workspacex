# 进度日志 — Sprint 01/06

## 当前已验证状态(唯一真相)
- 仓库根目录: `/Users/shenyangjun/boardx/workspacex/.worktrees/coord-deep-research-f174-ui`
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: `pnpm -w run verify:base`
- 当前最高优先级未完成功能: F174 / 引导式 Deep Research 六屏保真与研究入口收口
- 当前 blocker: GitHub issue 尚未创建；当前环境无 `gh` 与 GitHub API connector，需要在发布前补齐审计链

## 会话记录
### 2026-08-13 16:55:08
- 本轮目标: 按已签六张 UI 图收口 `/research` 主入口与真实浏览器链路。
- 已完成: 修复引导式/旧列表双激活；补 `/research` 裸路径和深路径同源代理；完成主题→方向→大纲真实持久化链路；补视觉契约测试与六屏并排 QA。
- 运行过的验证: 视觉契约 3 条；既有研究 UI 16 条；rewrite 反证 1 条；真实浏览器 1280/1920 六屏核对。
- 已记录证据: `evidence/design-qa/design-qa.md` 与 6 组 `*-comparison.png`。
- 提交记录: 待验证完成后提交。
- 已知风险或未解决问题: F170 的真实 Web Search 运行态与 F171 的真实报告数据仍是独立后续 feature；F174 不冒充实现这两项。
- 下一步最佳动作: 跑 F174 全部 verification，补 GitHub issue 后提交并开 PR。

### 2026-08-14 08:40:00
- 新增用户确认需求: 创建研究先填写必填名称和可选标签（最多 5 个），确认后进入 brief。
- 已完成: 弹窗交互、sessionStorage 跨步草稿、名称/标签 API 契约与数据库持久化、历史卡片标签展示、完整创建意图幂等指纹。
- 已通过: contracts 5 条、web 创建与恢复 7 条、API/web typecheck；本地迁移已应用。
- 已通过: 隔离 API 集成测试 6 条；真实浏览器创建→brief→directions→首页恢复名称和标签，控制台 0 错误；增量截图 `evidence/design-qa/07-create-research-dialog.jpg`。
- 下一步最佳动作: 补 GitHub issue 审计链，再跑 F174 完整 feature verification 并提交 PR。

### 2026-08-14 12:30:00
- 用户现场反证: `/research` 的 `guided-sessions` 请求连续返回 HTTP 401，但页面仍显示带 mock 用户名的研究壳和“历史研究加载失败”。
- 根因与修复: 引导式入口仍向 `AppShell` 传 `mockIdentity`，绕过了真实 `SessionProvider`；现仅显式 `?screen=…` 旧 Studio 保留预览身份，引导式入口由统一会话壳处理失效登录并跳转 `/login`。
- 已通过: 新增回归测试先红后绿；研究视觉/首页 11 条测试通过；web typecheck 通过；真实浏览器未登录访问 `/research` 已跳转 `/login`。
- 下一步最佳动作: 补 F174 GitHub issue 审计链，跑完整 feature verification 后提交 PR。
