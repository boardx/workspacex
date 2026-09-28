# 执行计划可视化标准（目标 → 理解 → Mermaid 流程图 → 颜色表进度）

> 2026-09-28 人类指令：**任何 AI** 接到人类布置的目标，开工前必须先表达「我理解的目标」
> 并给出执行计划；计划用 **Mermaid 流程图**呈现，**颜色表示每一步的进度**，并嵌入 harness
> 的开工 → 执行 → 验证 → 收尾全过程。
>
> 本文是这件事的**唯一规范**。状态调色板（具体色值）只在
> `.harness/scripts/execution-plan.mjs` 的 `PLAN_STATUSES` 定义一次；本文、模板、各计划文件
> 里出现的 `classDef` 副本都由 `pnpm run lint:execution-plan` 逐字核对。
> skill 入口：`.agents/skills/execution-plan/SKILL.md`（只引用本文，不复述）。

## 为什么

- **理解先于动手**：人类给的是意图，AI 要先用人类能验收的话复述一遍「目标 / 完成判据 /
  不做什么」。理解偏了，画出来的第一张图就会暴露——比做完再发现便宜两个数量级。
- **进度一眼可见**：文字进展报告要读完才知道卡在哪；一张着色的流程图，红色节点就是卡点，
  灰色就是还没碰的，人类 3 秒判断要不要介入。
- **与本仓完成定义同构**：「绿 = 做完」和「紫 = 有证据地测过」分开，就是 AGENTS.md
  「没有证据 = 没有完成」在进度图上的投影——AI 最常见的虚报是把「写完了」说成「好了」。

## 五种状态（颜色 = 进度）

| 状态 id | 颜色 | 含义 | 进入条件（**只信动态信号**，见 `static-trace-vs-live-fact.md`） |
|---|---|---|---|
| `todo` | 灰 | 未开始 | 计划里有这一步，还没动 |
| `doing` | 黄 | 已开始 | 你**此刻**正在做它（不是"打算做"） |
| `done` | 绿 | 已完成 | 这一步的产出物真实存在（代码已写 / 文档已写 / 命令已跑），但**还没有验证证据** |
| `tested` | 紫 | 已测试 | 验证命令**退出码 0**，证据可指向（命令原文、`evidence/` 路径、CI run）；图里必须带 `%% evidence <节点>: …` |
| `blocked` | 红 | 被堵塞 | 继续不下去：等人类决策 / 依赖未就绪 / 权限不足 / 验证失败修不动；图里必须带 `%% blocked <节点>: <卡在哪 / 需要谁做什么>` |

推进规则：
1. 正常路径 `todo → doing → done → tested`，不许跳级——尤其不许把没跑验证的步骤画成紫色。
2. 任何状态都可以进入 `blocked`；解除后回到被堵之前的状态。
3. 验证失败 ⇒ 该节点从 `done` 退回 `doing`（能修）或进入 `blocked`（修不动），**不许停在绿色**。
4. 目标节点 `G`：有任一步在做 ⇒ `doing`；全部 `done` ⇒ `done`；全部 `tested` ⇒ `tested`；
   有任一步 `blocked` 且其它步都推不动 ⇒ `blocked`。
5. 计划中途变了：**加节点**（`todo`），在进度日志写一句为什么；**不删已完成节点**——删掉就
   丢了"做过什么"的记录。整步作废的，改标签为 `（作废）…` 并在日志说明。

## 流程图写法约定（`lint:execution-plan` 机械核对）

- 一份计划 **一个** ```` ```mermaid ```` 块，以 `flowchart TD`（或 `LR`）开头。
- 节点写成 `S1[1. 动词开头的一步]`、目标写成 `G([目标：…])`、判断写成 `D1{…?}`；
  每一步都要有文字标签（裸标识符说不清这一步是什么，lint 不认它是节点）。
- 五个 `classDef` **全部**抄自模板 `.harness/templates/execution-plan.template.md`，颜色不许改。
- 每个节点**恰好一行** `class <节点> <状态>`；**不用** `节点:::状态` 简写（两种写法并存 =
  改一步要改两处）。改状态用脚本，不手改：
  ```bash
  node .harness/scripts/execution-plan.mjs set <计划文件> S3 doing
  node .harness/scripts/execution-plan.mjs set <计划文件> S4 tested --note "pnpm harness verify --sprint 05/02 --feature F03 → evidence/F03.verify.log"
  node .harness/scripts/execution-plan.mjs set <计划文件> S2 blocked --note "等人类在 #1234 选 A/B"
  node .harness/scripts/execution-plan.mjs summary <计划文件>   # 各色计数 + 红色原因，贴 issue 用
  node .harness/scripts/execution-plan.mjs check  <计划文件>
  ```
- 粒度：**5–12 个节点**。少于 5 个说明没拆，多于 12 个人类读不动——用 `subgraph` 分组，或把
  细节留在 issue 评论里。每个节点应能在一个工作块内推进到下一个颜色。
- 可并行的步骤画成分叉；验证步骤单独成节点（它是唯一能变紫的依据来源）。

## 嵌入 harness 过程（每个环节做什么）

| harness 环节 | 计划要做的动作 | 计划放在哪 |
|---|---|---|
| **接到目标**（任何形式：对话交办、sprint feature、coordinator 派工） | 先写「我理解的目标」四项（目标 / 完成判据 / 不做什么 / 假设与待确认）+ 画计划，`G` 与第一步标黄；有会改变计划的疑问**先问人再动手** | 见下 |
| sprint feature 开工（`active-features` 锁定唯一 `in_progress` 之后） | 从模板复制计划；节点应覆盖该 feature 的每条 `verification` | `phases/<phase>/sprints/<sprint>/plans/<feature-id>.plan.md`（入库）；并作为评论贴到该 feature 的 issue（GitHub 原生渲染 Mermaid）——AGENTS.md「每次迭代都在对应 issue 上展开」 |
| 直接交办的改动（`ad-hoc-fix-pr-sop.md`） | 同上，不要求入库文件 | 贴在轻量 issue 的评论里；PR 描述里附最终状态的图 |
| 对话里的一次性目标（无 issue） | 同上 | 直接在回复里给出图；里程碑处与收尾时重新给出最新着色 |
| 执行中 | 每开始一步 ⇒ 黄；产出落地 ⇒ 绿；撞墙 ⇒ 红 + 原因。**红色当场同步给人类**（issue 评论 / 对话），不攒到收尾 | 同一份计划文件就地改色 + 进度日志追加一行 |
| `pnpm harness verify` / 验证命令 | 退出码 0 ⇒ 对应节点紫色，`--note` 写命令与 evidence 路径；非 0 ⇒ 退回黄或转红 | 同上 |
| 收尾（`clean-state-checklist.md`） | 跑 `summary`，把结果写进 `progress.md` 的「已完成」与 `session-handoff.md`；issue 上贴最终着色图 | 计划文件随 PR 入库 |

**feature 能标 passing 的那一刻，它的计划应当全紫**；还有灰 / 黄 / 红却声称完成 = 计划与
事实不一致，reviewer 按「证据不足」处理。反之，全紫**不等于** passing——passing 只由
`pnpm harness verify` 门控（AGENTS.md「状态不能自己改」），计划图只是它的可视化投影。

## 机械门控与如实边界

- `pnpm run lint:execution-plan`（已接入 `verify:harness:raw`）：扫描模板、本文，以及
  `phases/**/*.plan.md`；判「有且只有一个流程图块 / 五个 classDef 与调色板逐字一致 / 每个
  节点恰好一个合法状态 / 红必有原因 / 紫必有证据」。反证套件：`.harness/scripts/execution-plan.test.ts`。
- **没有机械门控的部分**（如实列出，不是遗漏）：
  - 「接到目标时有没有画计划」——对话与 issue 评论里的图不在仓库里，脚本看不到；
  - 颜色是否与事实一致（画成紫色但证据是编的）——脚本只能判「写了证据」，判不了「证据为真」，
    这仍由 `harness verify` / `doctor` / reviewer 把关。

## 通用提示词（给不在本仓 harness 里的任何 AI，原样粘贴即可）

下面这段是自包含的；其中的 `classDef` 行是调色板副本，改色请改
`execution-plan.mjs` 并同步这里（`lint:execution-plan` 会核对）。

````text
你接到一个目标后，在做任何实际工作之前，先输出两部分：

一、我理解的目标
- 目标：用一句人类能验收的话复述结果
- 完成判据：怎样算做完（可执行的检查 / 可观察的行为）
- 不做什么：范围边界
- 假设与待确认：拿不准的点；若有会改变计划的疑问，先问，等回答再开工

二、执行计划：一张 Mermaid 流程图（flowchart TD），5–12 个节点，每个节点是动词开头的一步；
目标节点写成 G([目标：…])，验证步骤单独成节点。用颜色表示进度，classDef 固定如下、不得修改：

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

含义：todo=灰=未开始；doing=黄=已开始；done=绿=已完成（产出已存在但未验证）；
tested=紫=已测试（验证已通过，且写出证据：%% evidence 节点: 命令/结果）；
blocked=红=被堵塞（必须写出原因：%% blocked 节点: 卡在哪/需要谁做什么）。
每个节点恰好一行 `class 节点 状态`，不要用 `:::` 简写。

执行过程中：每当某一步状态变化，就更新颜色并重新给出整张图；遇到红色立刻告诉我，
不要攒到最后；没有跑过验证的步骤绝不能画成紫色；验证失败要退回黄色或转为红色。
结束时给出最终着色图，并用一行汇总各颜色的步数。
````
