---
name: session-closer
description: >
  激活条件：用户提到 收尾、关闭会话、结束、done、交接、下一轮、干净状态、
  写 handoff、progress 等关键词时触发。
  按 clean-state-checklist 干净收尾，写 handoff，确保下一轮全新上下文能仅靠仓库续上。
---

# Session Closer Skill

## 何时使用

一轮会话结束前。目标：让**下一轮以全新上下文启动的 agent，仅凭仓库内文件就能无缝续上**，
无需任何口头补充。

> 收尾方法论与写作模板见 **session-handoff** skill。
> 本 skill 是「关闭动作清单」。

---

## 为什么是「全新上下文」而非「带着记忆继续」

文章原则：长任务用**上下文重置 + 结构化交接产物**，而不是把旧对话压缩着拖下去
（压缩会诱发「context anxiety」，模型临近上限会草草收尾）。
所以收尾质量 = 下一轮的启动质量。**你写进仓库的，才是下一轮唯一能看到的。**

外部研究支撑这条选择（2025-2026 长任务 agent 上下文管理综述）：
生产系统通常在「压缩摘要」「结构化外部记忆（进度文件/检查点）」「子 agent 委派」
三种手段间选型，而**最稳健的系统是三者都用，而不是只押注压缩**——原因是压缩不保证
信息不丢失，只是降低丢失速度，对需要跨会话存活的具体事实（改了哪个文件、为什么
放弃了某个方案）不可靠。本仓选择的是「结构化外部记忆」这条路径：
`progress.md` + `session-handoff.md` 就是这层外部记忆，而不是指望模型自己压缩记住。
参照：[Context Compression vs Memory in AI Agents](https://mem0.ai/blog/context-compression-vs-memory-in-ai-agents)、
[AI Agent Context Window Management](https://dev.to/bobrenze/ai-agent-context-window-management-how-i-handle-tasks-that-take-longer-than-my-memory-4b47)。

---

## 能力清单（这个 skill 让你具备的动作）

- 执行六步「关闭动作清单」并逐条产出可核验的结果（不是心里过一遍）。
- 用 `git ls-tree HEAD -- phases/**/evidence/` 机械核实 evidence 已入库且非空——
  这是硬项，不是建议项，被 `.gitignore` 挡住必须上报而不是绕过。
- 判断 `git push --no-verify` 何时合规（仅纯文档/配置改动、且 worktree 缺
  node_modules 导致 pre-push 假红）：代码改动一律先装依赖跑过 pre-push，不得跳过。
- 判断「未记录的半成品」：任何"代码写了但没验证"的中间态，必须能在 handoff 里
  指出具体是什么、卡在哪一步，而不是含糊带过。
- 在七项自检清单全部为是之前，识别自己还不能结束本轮。

---

## 架构知识：与 session-handoff 的分工，及在链路里的位置

`session-closer` 是「开发 → 收尾 → 交接」链路的**清单执行层**，`session-handoff`
是**内容方法论层**——两者不重复定义同一件事：

- 关闭清单第几步该跑什么命令、门槛是什么 → 本 skill。
- `progress.md`/`session-handoff.md` 具体怎么写、常见写作错误有哪些 → [session-handoff]。

本 skill 是收尾流程的**终态判定器**：七项自检清单全部为是才能算「干净收尾」，
这与 `.harness/rubrics/clean-state-checklist.md` 是同一份权威的不同投影——
后者是给整个仓库（含非 agent 场景）用的通用清单，本 skill 的七项自检是针对
「本轮 agent 会话结束前」这个具体时刻的可执行版本，两者对应但不是同一份文本，
改动权威清单时要检查本 skill 的七项是否需要跟进。

---

## 领域/商业知识：为什么「全新上下文续接」是本仓的硬约束

- 长任务 agent 若靠「压缩旧对话继续」，两个已观察到的失败模式都会命中本仓：
  1. **上下文腐化不报错**——模型不会说"我快忘了"，只是逐渐处理质量下降，
     等到明显出错时已经晚了。这正是本仓不允许"代码写完了看起来能跑"当完成证据的理由之一：
     人（或下一轮 agent）不能信任"看起来还记得"的判断。
  2. **冷启动代价高**：agent 撞见不明状态时会先花大量精力摸清现状，
     这段时间对交付无贡献。「clean state = 唯一可接受标准」就是要把这段成本清零。
- 本仓的具体落地是 evidence 必须进 git 树（而非泛泛的"写文档"）：因为 git 树是
  唯一保证"下一轮全新上下文，无论是谁、在哪台机器，都能看到同一份东西"的载体——
  本地文件、内存对话、口头交接都不满足这个性质。

---

## 关闭动作清单

```bash
# 1. 逐项过干净状态检查清单
cat .harness/rubrics/clean-state-checklist.md
```

2. **更新 `progress.md`**：本轮目标、完成项、未完项、下一步。
3. **写 `session-handoff.md`**：下一步动作具体到**命令级别**（能直接复制粘贴跑），
   不是「继续做 F03」而是「跑 `pnpm harness verify --sprint 01/01 --feature F03`，若 X 则 Y」。
4. **状态真实性**：feature 清单如实反映 passing / 未验证边界，**没有假 passing**。
5. **无未记录的半成品**：任何「代码写了没验证」的中间态都要在 handoff 里写明。
6. **证据文件在 git 树中（硬项，PR #310/#311/#312 事故——evidence 指向未入库文件，
   等于指向空气，见 `.agents/skills/session-handoff` 的完整叙述）**：

```bash
git ls-tree HEAD -- phases/**/evidence/
```

   本轮引用的每个 evidence 路径都必须出现在输出中且 blob 非空。
   被根 `.gitignore`（如 `*.log`）挡住 = 异常，立即上报，**禁止以「本地留存」收尾**。

```bash
# 6. 基础路径仍可用（收尾前最后一道）
pnpm -w run verify:base
```

---

## 收尾自检（任一为否则没收干净）

- [ ] 新 agent 只读 `progress.md` + `session-handoff.md` 就知道下一步该跑什么命令？
- [ ] `verify:base` 仍绿？
- [ ] 没有 feature 处于未记录的中间态？
- [ ] 没有手改过 status 或 `active-features.json`？
- [ ] evidence 文件经 `git ls-tree HEAD` 实测在 git 树中且非空？
- [ ] 起的服务/后台进程都收掉了？
- [ ] push 成功？（fresh worktree 的 pre-push 会因缺 node_modules 报 turbo not found：
      纯文档/配置改动可 `git push --no-verify` 并写明理由；代码改动必须先装依赖跑过再推）

全部 ✅ 才能结束本轮。

---

## 迭代/进化机制

1. **谁踩坑谁回流**：本轮收尾撞到清单没覆盖的新失败模式（例如新的 push 假红原因、
   新的"看起来干净实则不干净"的状态），在同一 PR 里往「收尾自检」表**追加一条**，
   不新开笔记文件。
2. **与权威清单的一致性**：`.harness/rubrics/clean-state-checklist.md` 变更后，
   检查本 skill 的七项自检是否需要跟进对齐；反过来发现本 skill 的自检比权威清单
   更细/更准时，考虑回哺权威清单，而不是让两份文本各自演化出分歧。
3. **不复述具体检查项原文**：与 session-handoff 一样，Step 2 的清单动作只引用
   `cat .harness/rubrics/clean-state-checklist.md`，不在本文件里逐条复制——
   这条已经在 2026-08 因「抄 rubric 全文」被修过一次，回归会被视为倒退。
