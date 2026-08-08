---
name: feature-implementer
description: >
  激活条件：用户提到 实现、开发、写代码、做 feature、in_progress、开始干活、
  把 feature 做出来 等关键词时触发。
  固化 AGENTS.md 工作流：只做一个 feature、先有验证再写码、自测留证据、干净收尾。
---

# Feature Implementer Skill

## 何时使用

要动手实现一个 feature 时。本 skill 把 AGENTS.md 的「开工流程 + 硬约束」
落成可执行步骤。

> 编码规范见 [coding-standards.md](.harness/instructions/coding-standards.md)。
> 本 skill 只讲实现者的纪律与顺序。

---

## 能力清单（这个 skill 让你具体能做什么）

- 从 `active-features.json` 机械锁定唯一 `in_progress` 目标，拒绝在没有目标或
  目标不唯一时动手。
- 判断「完成契约」（verification）是否已经存在且可执行，缺失时停下回退到
  [verification-writer]，而不是自己顺手补一条再自己实现自己验证。
- 把 verification 在心里拆成「前置条件 / 触发动作 / 期望后置状态」三段
  （见下方领域知识①），据此判断最小实现的边界在哪，不多做也不少做。
- 动手前先重跑一遍 verification 确认它此刻确实是红的（环境可能已变化），
  防止「契约形同虚设」的假绿（见下方领域知识②）。
- 按范围纪律 checklist 逐项自查 diff，识别「顺手改无关文件」「手改 status」
  等红线。
- 把 evidence 落盘并用 `git ls-tree`/`git cat-file` 实测入库，不接受「本地
  留存」。
- 返工场景下产出「review 意见 → commit/文件」的逐条修复映射表，控制 diff 面积。

---

## 架构知识：这一环在全链路里的位置

```
verification-writer（定契约，先于实现存在）
        │
        ▼
[feature-implementer]（你）── 最小实现 + 自测 + evidence 入库 ──┐
        │                                                      │
        ▼                                                      ▼
pnpm harness verify（重新执行 verification，门控 status → passing）
        │
        ▼
rev-feature / PR review（核对范围纪律、evidence 真实性）
        │
        ▼
harness doctor（合并后审计 evidence 真实性 + issue/PR 闭环，ADR-012）
```

- **上游输入**：verification-writer 产出的 `verification` 数组（完成契约）+
  requirement-author 产出的 `user_visible_behavior`/`spec_ref`（要满足什么）。
  契约不存在 = 不具备开工条件，这是硬顺序，不是建议顺序。
- **下游消费者**：`pnpm harness verify` 重新跑你自测过的同一批命令（不是另一套）；
  reviewer（rev-feature）核对 diff 范围与 evidence 真实性；`harness doctor` 在
  合并后做审计链体检（passing 证据真实性 + GitHub issue/PR 闭环，AGENTS.md
  完成定义第 5、6 条）。
- **机械门控重新校验点**：`assertSingleInProgress`（同一 owner 同时只能有一个
  in_progress，ADR-001）、`pnpm harness verify` 的退出码、`doctor` 的证据链
  审计（ADR-012）——你手改 status 或伪造 evidence，这些环节会在你离开会话后
  暴露，不是当场就能糊弄过去。

---

## 领域/商业知识：为什么这样设计

**为什么「先有 verification 再实现」不是流程洁癖，而是防「自我背书」**：
如果实现者可以自己定验收标准，验收标准会不自觉地向「我已经写出来的代码」
收敛，而不是向「用户真正需要的行为」收敛——这是软件工程里公认的效度问题
（生成者与评审者身份重合会系统性抬高误判为合格的概率）。本仓的
`feature-evaluator`/`rev-feature` 用独立上下文评审就是同一原则的另一种实现
（评审隔离），而「verification 先于实现存在」是把同一原则前移到写代码之前。

**①契约先行（Contract-first / Design by Contract）给的具体技法**：外部研究里
Design by Contract 用 precondition / postcondition / invariant 三元素描述一个
操作的契约。把这套语言套在本仓的 verification 上：
`user_visible_behavior` 里的「触发条件」≈ precondition，
「产生什么可观察结果」≈ postcondition，跨多条 verification 都必须成立的
断言（如某个不变量）≈ invariant。写最小实现前，先用这三个词把 verification
在心里转译一遍，比直接读一遍命令行更容易发现「这条命令其实没覆盖到某个
后置状态」这类契约缺口。

**②TDD 的 red-green 循环用在契约层而非仅单元测试层**：经典 TDD 强调「先看到
测试失败（red），再让它变绿（green）」，价值在于确认测试本身是有效的、
不是一条永远为真的空判断。本仓的 verification 是端到端/契约层断言而非单元
测试，但同一逻辑适用：verification-writer 要求"写完后先故意制造失败"，
feature-implementer 在动手实现前**应该重新跑一遍确认它此刻仍是红的**——
如果一上来就是绿的（比如上一个 feature 已经顺带满足了这条断言，或断言本身
写错了），说明契约有问题，回到 [verification-writer] 而不是直接开始写「实现」
去满足一条根本没在测什么的命令。

**「顺手改无关文件」为什么是硬红线**：范围纪律不是代码洁癖，是可追溯性——
一个 PR 只对应一个 issue、一个 feature（AGENTS.md 硬约束），混入无关改动会
让 evidence 与 diff 的对应关系失真，`doctor` 的审计链体检也失去意义
（它假设 PR 范围 == feature 范围）。

---

---

## 实现者五步

```bash
# 1. 锁定唯一目标 feature（只能有一个 in_progress）
cat phases/<phase>/sprints/sprint-<MM>/active-features.json \
  | jq '[.features[] | select(.status=="in_progress")]'
```

2. **先确认「完成契约」存在**：这个 feature 的 `verification` 命令必须已经写好。
   没有就先停下，回到 [verification-writer] 把契约定下来——**绝不先写实现再补验证**
   （那是自我背书，文章明确反对生成者给自己定标准）。

3. **只写满足契约的最小实现**。范围纪律见下表，别顺手重构无关区域。

4. **自测留证据**：本地逐条跑 `verification`，把输出留到 `evidence/`。
   长输出/起服务的活体验证，委托 **test-runner** / **e2e-verifier** subagent，
   别让冗长日志污染主线程。
   **证据必须入库**（PR #310/#311/#312 教训）：提交后用
   `git ls-tree HEAD -- phases/**/evidence/` 实测文件在 git 树中且非空；
   被 `.gitignore` 挡住是异常，立即上报，禁止「本地留存」。

5. **收尾**：交给 [session-closer]。

---

## 范围纪律 checklist

| 检查 | 红线 |
|------|------|
| 只动当前 feature 涉及的文件？ | 顺手改无关文件 = 引入未验证改动 |
| 没碰 `active-features.json`？ | 它是脚本派生只读视图 |
| 没手改 status 成 passing？ | 只有 `pnpm harness verify` 能升级状态 |
| status/owner/evidence 字段没出现在手写 diff 里？ | 出现即 review 阻断嫌疑（L2） |
| 没跨包深路径 import？ | 走包的公共入口 |
| 错误用结构化返回（非裸 throw）？ | 见 coding-standards |
| 500 分支没把 `String(err)` 回给客户端？ | 错误响应用通用文案，详情 `console.error` 落服务端日志（PR #310 教训） |
| e2e/fixture 没有 `any`？ | 用 `Page`、`PlaywrightWorkerArgs["playwright"]`，禁 `(page: any)` |

---

## 返工 PR 最小化（正面案例 PR #314）

review 打回后的返工只包含：**review 要求项的修复 + 必要证据**，不顺手带无关改动。
在 PR 描述里给出「逐条修复映射表」（review 意见 → 对应 commit/文件），reviewer 会核对。

---

## 完成的硬定义（权威在 AGENTS.md，不在这里复述）

一个 feature 只有同时满足 AGENTS.md「完成定义」（DON'T EDIT 区块）的**全部条款**才算
`passing`——**不要在本文件里复制这份清单**：2026-07-29 那次它从 4 条加到 6 条
（新增"该 feature 在 GitHub 上有对应 issue 且已由 PR 关闭"与"实现已合入 main"），
本文件当时没跟着改，照旧版执行会漏掉这两道机械门控、把只停在分支上的活误判成完成。
动手前去读一遍 AGENTS.md 原文，别信任何转述（包括这句）。

**没有证据 = 没有完成。**「代码写完了」「看起来能跑」都不算。

---

## 多 agent 并行（owner）

并行模式下用 `pnpm harness claim --phase NN --feature F0X --owner <id>` 认领，
每个 owner 各自最多一个 in_progress。认领后只做自己那一个。

---

## 迭代/进化机制：这个 skill 本身怎么变好

- **范围纪律 checklist 是 append-only 的事故沉淀点**：每次 review 打回暴露出一条
  新红线（比如新的「顺手改」模式、新的错误处理反模式），在 checklist 表里加一行，
  标注出处（PR 号/review 意见），不要只在当次会话口头纠正。
- **「返工 PR 最小化」案例库**：PR #314 是当前唯一收录的正面案例；后续如果出现
  同样值得参照的返工（返工范围精确、映射表清楚），补充进来，形成可复用的
  「返工应该长什么样」参照集，而不是只留一条孤例。
- **契约转译技法的校准**：DbC 三元素（precondition/postcondition/invariant）与
  TDD red-green 技法是外部参照，本仓的实际语义以 `AGENTS.md`「完成定义」与
  verification-writer 的防假阳性手法为准——如果两者出现分歧，以本仓机械门控
  的实际行为为准，回来修正本节的类比，不要让类比反过来误导对机械门控的理解。

<空，升级开始后追加>

