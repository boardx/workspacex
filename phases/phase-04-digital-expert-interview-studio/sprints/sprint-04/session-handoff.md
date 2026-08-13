# 会话交接 — Sprint 04/04

## 当前已验证
- F04 仍为 `in_progress`，没有宣称 passing。
- 已验证当前 UI 切片：设计 lint、Web TypeScript、访谈 UI 10 条测试与 diff 检查均通过。

## 本轮改动
- 从 `experts_persona.json` 整理 97 位临时 Mock 专家，接入 Studio 专家列表、分类筛选、专家详情和快捷访谈。
- 快捷访谈展示专家说明，允许本地发送问答并可转为 Mock 批量访谈。
- 新增全屏创建访谈流程，首步包含访谈名称、标签和访谈主题。
- Studio 新建入口现为弹窗，仅收集名称与最多 5 个标签；提交后直接进入五步 Mock 访谈流程。
- 五步流程支持确认主题、增删专家、编辑针对性问题、执行 Mock 访谈及查看 Markdown Mock 报告时间线。
- 左侧 Skill 助手可通过对话给出主题/专家/问题/报告建议；只有显式点击应用才改内容，并可撤销最近一次应用。
- 本地 Mock 草稿刷新可恢复，返回 Studio 历史页后会显示对应卡片并继续当前步骤。
- 补回 `/api/v1/interviews` 代理规则，避免 HTML 404 被当 JSON 解析。

## 仍损坏或未验证
- Mock 专家只用于当前交互验证，不是正式专家事实源，也不作为访谈证据。
- 正式 F04 后端持久化、针对性问题生成、批量访谈运行与报告生成仍未完成。
- 本轮范围验证已完成；正式 F04 仍需用真实 API/数据库/模型链路补齐全功能验证。

## 下一步最佳动作
- 继续 F04 的正式后端接线；复用已确认的五步 UI 与 Skill 显式应用契约，不把 Mock 内容升级为证据。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 04/04`
- 调试:`pnpm --filter web exec vitest run tests/ui/interview-studio-home.test.tsx tests/ui/quick-digital-interview.test.tsx tests/ui/interview-setup-workflow.test.tsx tests/ui/interview-skill-assistant.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1`
