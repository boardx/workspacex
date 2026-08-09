---
name: session-handoff
description: >
  激活条件：用户提到收尾、交接、下一轮、session、handoff、会话结束、
  干净状态、progress、session-handoff 等关键词时触发。
  提供干净会话收尾的完整方法论和写作模板。
---

# Session Handoff Skill

## 为什么收尾比开工更重要

一次糟糕的收尾会让下一轮 agent（或你自己）从"破损状态"开始工作，浪费 20-30 分钟修复上下文。  
**"无需人工修复即可继续"是唯一可接受的收尾标准。**

---

## 能力清单（这个 skill 让你具备的动作）

- 跑 `pnpm -w run verify:base` / `pnpm harness verify` 判断收尾前状态是否干净、能否升 passing。
- 对照 `.harness/rubrics/clean-state-checklist.md` 逐项检查（引用文件本身，不在这里复述条目——
  条目会改，复述会漂移）。
- 写 `progress.md` 的一条增量日志（append，不覆盖历史）。
- 写 `session-handoff.md` 的四段快照：当前已验证 / 本轮改动 / 仍损坏或未验证 / 下一步最佳动作，
  且每个 evidence 路径先跑 `git ls-tree HEAD -- <路径>` 实测非空再引用。
- 识别六类常见收尾错误（见下表）并当场纠正，而不是留给下一轮发现。
- 判断何时可以用"快速收尾模板"（时间不够时的最低标准），何时不可以（有 in_progress 但状态不明时不行）。
- 在跨项目/模板仓场景下，额外检查 placeholder 与 skill 是否需要跟着本轮经验更新。

---

## 架构知识：这一步在整条链路里的位置

`session-handoff` 是「开发 → 收尾 → 交接」链路里的**产物层**：
它不负责判断"要不要收"（那是 [session-closer] 的清单动作），只负责"收尾产物长什么样、
怎么写才能被下一轮读懂"。两个 skill 的分工边界：

- **session-closer** = when + checklist（先跑什么、检查哪几项、全绿才能走）。
- **session-handoff**（本 skill）= 内容方法论 + 写作模板（progress.md 怎么写、
  session-handoff.md 怎么写、常见错误长什么样）。

两份产物的性质不同，不要混用：
- `progress.md` 是 **append-only 的时间线**——每轮加一条，不删旧条目，价值在于"回放历史"。
- `session-handoff.md` 是**覆盖式的最新状态快照**——只反映"现在"，价值在于"下一轮从这里直接起步"。

下一轮 agent 的启动路径**完全依赖这两份文件 + 仓库本身**（无口头交接、无对话记忆）。
这也是为什么"下一步动作必须具体到命令级别"不是文风偏好，而是硬约束：读者是一个
对本次对话零记忆的全新上下文，写"继续做 F03"对它没有任何信息量。

同时要认清 `progress.md`/`session-handoff.md` 与 `active-features.json` 的关系：后者是
`feature_list.json` 派生出的只读视图，收尾时**只能通过 `pnpm harness verify` 门控转移状态**，
不能在收尾文档或手工编辑里让某个 feature "看起来" passing。

---

## 领域/商业知识：为什么这样设计

- **本仓真实事故**：PR #310/#311/#312 中，handoff 写了"本地留存""见本地日志"，
  指向的文件根本没有提交进 git 树。下一轮全新上下文只看得到仓库，指向未入库文件的引用
  就是指向空气——代价是下一轮又要从头分析一遍现场。这是"evidence 路径必须先
  `git ls-tree HEAD` 实测"这条硬规则的直接来源。

- **外部研究佐证本仓的两条设计选择**（2025-2026 长任务 agent 上下文管理研究）：
  1. **上下文腐化（context rot / drift）是长任务失败的主因之一，且不报错、只是悄悄失准**——
     模型不会明确报错，只是逐渐"不太看得懂"堆积的旧信息（多篇 2025-2026 综述，见下方参照）。
     这解释了为什么本 skill 坚持"结构化产物"而非"依赖模型自己记得"。
  2. **结构化交接（固定 schema：改了哪些文件 / 做了什么决策 / 进行到哪一步 / 已知约束）
     比自由摘要保留更多可复用信息**——这正是 `session-handoff.md` 四段式模板（当前已验证 /
     本轮改动 / 仍损坏 / 下一步）的设计依据，不是随意选的格式。
  3. **"温启动"优于"冷启动"**：有实验观察到，agent 撞见破损/不明状态时，会先花大量时间
     摸清现状、修复基础环境，才能开始干正事——这正是本仓「clean state = 唯一可接受标准」
     这条硬约束想要避免的成本。收尾产物的意义就是把下一轮变成温启动。
  4. **生产系统常在容量利用到七成左右就主动做结构化落盘，而不是等溢出**——这与本仓
     "每轮会话结束前收尾"是同一原则的两种触发方式：一个按时间/轮次触发，一个按容量触发。

  参照（本轮调研，非本仓权威文件，仅作方法论佐证）：
  - [Context Window Management and Session Lifecycle for Long-Running AI Agents](https://zylos.ai/research/2026-03-31-context-window-management-session-lifecycle-long-running-agents/)
  - [AI Agent Handoff: Why Context Breaks & How Structured Memory Fixes It](https://xtrace.ai/blog/ai-agent-handoff-why-context-gets-lost-between-agents-and-how-to-fix-it)
  - [Evaluating Context Compression for AI Agents (Factory.ai)](https://factory.ai/news/evaluating-compression)

---

## 收尾流程（逐步执行）

### Step 1：验证基础状态

```bash
# 基础验证必须通过（这是底线）
pnpm -w run verify:base

# 如果有 in_progress 的 feature，运行 verify 看是否能升 passing
pnpm harness verify --sprint <NN>/<MM>
```

### Step 2：对照检查清单

```bash
cat .harness/rubrics/clean-state-checklist.md
```

**逐项打勾，不要跳过任何一条——清单内容是权威，本文件不重复列举**（`.agents/skills/
session-closer` 的"关闭动作清单"同样引用这份文件；两处各抄一份迟早对不上，
已经发生过一次：rubric 后来加了 docker/worktree 两条，抄过来的副本没跟上）。

### Step 3：更新 progress.md

```markdown
### <日期时间>
- 本轮目标：<具体说做了什么>
- 已完成：<F01 passing（通过 verify）/ 修复了 X bug / 新增了 Y 文件>
- 运行过的验证：<列出跑过的命令>
- 已记录证据：<evidence/F01.verify.log>
- 提交记录：<git commit hash 或 "未提交">
- 已知风险或未解决问题：<无 / 描述>
- 下一步最佳动作：<具体命令，不是"继续做 F02"这种模糊描述>
```

### Step 4：更新 session-handoff.md

**关键原则：下一步动作必须具体到命令级别**

```markdown
## 当前已验证
- F01 passing — evidence/F01.verify.log @ 2026-06-29T...
- F02 passing — evidence/F02.verify.log @ 2026-06-29T...

> handoff 里引用的每个 evidence 路径**必须是已提交进 git 树的路径**
> （写之前 `git ls-tree HEAD -- <路径>` 实测）。禁止写「本地留存」「见本地日志」——
> 下一轮全新上下文只看得到仓库，指向未入库文件的引用就是指向空气（PR #310/#311/#312 事故）。

## 本轮改动
- 修改了 packages/memory/src/index.ts（新增 DurableMemory.findByTag）
- 修改了 packages/tools/src/index.ts（修复 ShellTool 超时处理）

## 仍损坏或未验证
- F03 in_progress — pnpm test 跑到一半，orchestrator.test.ts:42 失败
- 原因：memory 的临时目录清理有竞争条件

## 下一步最佳动作
1. `cd /path/to/repo && ./init.sh`
2. `pnpm harness verify --sprint 01/01 --feature F03` 查看当前失败原因
3. 修复 apps/orchestrator/src/orchestrator.test.ts:42 的竞争条件
4. 不要动 F01/F02，它们已经 passing

## 命令
- 验证: `pnpm harness verify --sprint 01/01`
- 测试单包: `pnpm --filter @repo/memory test`
- 调试特定测试: `pnpm --filter @repo/orchestrator test -- --reporter=verbose`
```

---

## 常见收尾错误

| 错误 | 影响 | 正确做法 |
|------|------|---------|
| "下一步继续做 F03" | 下轮 agent 不知道从哪行代码开始 | 写具体到命令的下一步 |
| 不更新 progress.md | 上下文断裂，下轮从头分析 | 每轮必须更新，哪怕几行 |
| 把失败的测试"暂时注释掉" | 留下未记录的半成品 | 要么修复，要么在 notes 里记录原因 |
| verify:base 失败但继续收尾 | 下轮从破损状态开始 | 先修基础状态 |
| evidence 写"本地留存"或指向未入库文件 | 下轮/reviewer 看到的是空气引用 | 证据文件提交进 git 树后再引用 |
| 把 not_started 的 feature 标 in_progress | 超过单一 in_progress 约束 | 一次只做一个 |

---

## 快速收尾模板（时间不够时的最低标准）

```bash
# 运行完这三条才能离开
pnpm -w run verify:base && \
pnpm harness verify --sprint <NN>/<MM> && \
echo "收尾验证通过"
```

然后至少写：
```markdown
# session-handoff.md 最低版本
## 当前状态
- F01 [passing/in_progress/not_started]
## 下一步
- <一条具体命令>
## 注意
- <一个已知风险>
```

---

## 跨项目（template）收尾额外检查

如果这个 monorepo 是用于孵化新项目的模板：

- [ ] 所有 placeholder（`your-org/my-monorepo`、`my-monorepo` 项目名等）已更新或有说明
- [ ] `.agents/skills/` 中的 skill 是否需要根据本项目经验更新
- [ ] `harness.config.yaml` 中的路径是否与实际项目结构匹配
- [ ] `README.md` 是否反映了当前实际可用的状态

---

## 迭代/进化机制

本 skill 自身也要吃「结构化交接」这一套——每轮收尾如果发现新的收尾错误模式、
新的模板缺口，或者外部研究出现推翻本文假设的新证据，回流到本文件而不是只在
`progress.md` 里写一句带过。

1. **谁踩坑谁回流**：本轮收尾中发现"常见收尾错误"表里没覆盖的新坑（例如新的
   假 evidence 变体、新的 handoff 断链模式），在同一个 PR 里往上方表格**追加一行**，
   不要另起一份笔记。
2. **模板变更走 review**：`progress.md`/`session-handoff.md` 的写作模板若要改结构
   （不是措辞微调），走正常 PR review——它是全仓下一轮读取的契约，改坏了影响所有 agent。
3. **外部研究引用需要标注日期与来源**，且只作方法论佐证，不作为本仓门控依据——
   门控只能来自 `.harness/` 下的脚本与 rubric。
4. **不复述 rubric 全文**：`clean-state-checklist.md` 的具体检查项只能引用，
   本文件改回复述会重新制造第二份副本（2026-08 已修过一次）。
