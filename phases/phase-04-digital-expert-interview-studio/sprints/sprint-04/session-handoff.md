# 会话交接 — Sprint 04/04

## 当前已验证
- F04 仍为 `in_progress`，没有宣称 passing。
- 已在当前 `origin/main` 上完成 rebase；正式 F04 的 contracts 13/13、Web 31/31、API/Web/contracts TypeScript、design lint 与 diff 检查通过。
- 隔离 PostgreSQL 验证 4 文件 23/23 通过，覆盖迁移、HTTP、组织隔离、幂等、Skill 与三个 receipt→checkpoint 崩溃恢复窗口；122 个迁移空库执行、强制回放与 schema digest 通过。
- 独立最终复审在 exact SHA `69a8eb808495471e0f46f1fabbbab9dd36c51b42` 为 READY，Critical/Important/Minor 均为 0。

## 本轮改动
- 正式创建入口改走 `POST /interviews/digital`，使用服务端返回的访谈 ID；生产历史、专家目录和 setup 不再读取本地 Mock。
- 用 TypeScript LangGraph 将主题、专家、问题确认映射为节点，PostgreSQL Checkpointer 保存运行位置，规范化业务表保存可查询事实。
- 每一步只在用户明确确认时持久化；写操作具备 aggregate 版本检查、访谈范围幂等 receipt、组织隔离和重启恢复。
- 服务端生成可审核专家候选与每专家默认三问；专家快照带 Agent Definition/版本及结构化材料指针。
- Skill 消息、草稿上下文、建议 apply/reject 与 stale 状态完整持久化，同一访谈版本连续递增。
- 补齐业务提交成功但 checkpoint 未推进的主题、生成和终态三个崩溃窗口恢复。
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
- F04 尚未合入 `main`，因此不能标记 passing；需 PR 合入后由 harness verify 完成状态转移。
- F05 的批量专家运行与 F06 的可追溯报告不属于本次 F04 范围。
- `pg` 的 concurrent `client.query()` 弃用预警需在升级 pg@9 前处理。

## 下一步最佳动作
- 推送当前分支并创建关联 issue #1317 的 F04 PR；合入后执行 `pnpm harness verify --sprint 04/04`。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 04/04`
- 调试:`pnpm --filter web exec vitest run tests/ui/interview-studio-home.test.tsx tests/ui/quick-digital-interview.test.tsx tests/ui/interview-setup-workflow.test.tsx tests/ui/interview-skill-assistant.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1`
