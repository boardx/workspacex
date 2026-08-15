# 会话交接 — Sprint 01/10

## 当前已验证
- F156（个人对话零跨范围召回 + 自有附件可召回真栈反证）：`passing`。
  `pnpm --filter api exec vitest run tests/chat/personal-thread-zero-retrieval.test.ts` 通过（V1-V5）；
  官方门控 `pnpm harness verify --sprint 01/10 --feature F156` 通过，证据见
  `sprints/sprint-10/evidence/F156.verify.log`。

## 本轮改动
- 生产代码：`context-snapshot.ts`/`execute-run.ts`/`pg-agent-run-context-snapshot.ts` 新增
  `l3RetrievalScope`（`own-attachment` | `project-retrieval` | `null`），随 F157 快照列一起落库
  （迁移 `20260815110000_f156_l3_retrieval_scope.sql`）。这是本 feature 唯一的生产代码改动——
  召回边界本身（个人线程 `project_id IS NULL AND created_by = actor`）在 F155 就已实现，本轮
  只是补上"这次查询走的是本线程范围还是项目范围"的可分辨字段。
- 设计层：`personal-thread-own-attachment-recall` delta 已签核，把 F156 的零召回边界从"绝对
  零召回"修订为"零跨范围召回，但允许召回本线程自己的附件"，`chat-context-engine` 束
  `design-signoff.md` 的 `covers` 冲突（F156 被两处声明）已修——唯一权威见该 delta 自己的
  `design-signoff.md`。
- 顺带定位并修复了一个通用 harness bug（不在本 feature 的生产代码改动范围内，但直接阻塞了
  本 feature 的官方门控）：`.harness/scripts/lib/sh.ts` 的 `sh()` 用 spawnSync 给 stdout/stderr
  各开一条独立 pipe，双流大体量并发输出会撞上 Node 已知限制导致挂起（PR #1360）；其回归测试
  又踩了一次"墙钟阈值断言在共享机器上假红"（PR #1385）。两个修复都已合入 main，本分支已
  rebase 上去。这个 bug 影响所有走 standard/high_risk 风险档的 feature 官方 verify 门控，不止
  F156——之前一些"随机 flaky 重试就过"的门控卡死，很可能就是这个根因。

## 仍损坏或未验证
- 无已知阻塞。sprint-10 目前只有 F156 一条 feature。

## 下一步最佳动作
- 本 feature 完成，push 分支、开 PR（`Closes #1351`），合入后清理本 worktree。
- 之后 context-engine 束下一条待办是 F185（工具调用轨迹跨 run 回喂上下文）——已写需求
  （`requirements/08-chat/uc-8-10-工具调用轨迹跨run回喂上下文.md`），但**明确不能直接开工**：
  会碰 `execute-run.ts`（需 coord-main 串行窗口）且引入 L1/L2/L3 之外的第四类上下文来源，
  超出 `chat-context-engine` 束已签参数字面范围，必须先走 design-delta 人类签核（R4 列了
  5 个待决设计问题）。下一步是把这条 delta 提给人类，不是直接写代码。
- F150/F153（附件上传 + 抽取进 L3）属 `chat-file-upload` 束，不是本束；F150 阻塞于 F110，
  F153 又阻塞于 F150，暂不可开工。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/10`
- 调试:`pnpm --filter api exec vitest run tests/chat/personal-thread-zero-retrieval.test.ts`
