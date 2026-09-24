# 进度日志 — Sprint 09/01

## 当前已验证状态（唯一真相）
- 工作目录：`/Users/shenyangjun/.codex/worktrees/survey-f04-runtime/workspacex`
- 分支：`codex/survey-f04-runtime`；对应 issue：#4037。
- F04 实现与真实浏览器链路已完成；权威 feature 状态仍保持 `not_started`，不得在 PR 合入 `main` 前手改为 passing。
- 未访问协调网关；本轮按人类指令直接在隔离 worktree 中开发并提交 PR。

## 2026-09-25 实施记录
- 建立 `draft → ready → collecting → closed` 四态状态机与服务端发布门禁。
- 发布准备一次返回全部阻断项；修复后才生成发布链接；开始回收、撤回发布、截止回收均持久化并受版本冲突保护。
- 匿名性在创建后不可修改；客户端区分业务阻断、版本冲突与可重试系统错误。
- Live 问卷工作台接入准备发布、撤回、开始回收、失败重试和刷新后状态恢复。
- 新增 API、契约、UI 与真实 Playwright + PostgreSQL 端到端覆盖；浏览器证据见 `evidence/F04-blockers.png` 与 `evidence/F04-browser.png`。

## 验证边界
- F04 权威验证：3 个文件、10 项测试全部通过。
- 受影响题型回归：31/31 通过；发布失败相关 Web 回归独立复跑 62/62 通过。
- 真实浏览器 + API + PostgreSQL：阻断、修复、准备发布、开始回收、刷新持久化、匿名性 409 均通过。
- `verify:release` 三次执行；最后一次完整执行中 API 1077/1078 文件、Web 537/538 文件通过，剩余两个非本范围并发脆弱用例均独立复跑通过。未把该结果伪装为全量绿色，交由 PR CI 在干净 runner 上重新裁决。

## 下一步
- 创建 `main` 目标 PR，关联 `Closes #4037`，等待人工合并；不得开启自动合并。
- PR CI 如出现失败，继续在此分支修复或复跑直至 required checks 通过。
