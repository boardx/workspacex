# 会话交接 — Sprint 04/04

## 当前已验证
- F04 仍为 `in_progress`，没有宣称 passing。
- 已验证当前 UI 切片：设计 lint、Web TypeScript、访谈 UI 7 条测试、diff 检查与本地路由 smoke 均通过。

## 本轮改动
- 从 `experts_persona.json` 整理 97 位临时 Mock 专家，接入 Studio 专家列表、分类筛选、专家详情和快捷访谈。
- 快捷访谈展示专家说明，允许本地发送问答并可转为 Mock 批量访谈。
- 新增全屏创建访谈流程，首步包含访谈名称、标签和访谈主题。
- 补回 `/api/v1/interviews` 代理规则，避免 HTML 404 被当 JSON 解析。

## 仍损坏或未验证
- Mock 专家只用于当前交互验证，不是正式专家事实源，也不作为访谈证据。
- 正式 F04 后端持久化、针对性问题生成、批量访谈运行与报告生成仍未完成。
- 本轮没有运行整个 monorepo `verify:base`；仅运行了范围内验证，合入前需在最新 main 血统上复跑。

## 下一步最佳动作
- 继续 F04 的正式后端接线；保持 `experts_persona.json` Mock 边界文案和现有 UI 测试锚点。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 04/04`
- 调试:`pnpm --filter web exec vitest run tests/ui/interview-studio-home.test.tsx tests/ui/quick-digital-interview.test.tsx tests/ui/interview-setup-workflow.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1`
