---
name: sprint-planner
description: >
  激活条件：用户提到 规划、sprint、排期、分配 feature、切 sprint、依赖、并行、
  迭代计划、new-sprint 等关键词时触发。
  把 feature_list 切成可执行的 sprint，处理依赖与并行，包装 harness new-sprint。
---

# Sprint Planner Skill

## 何时使用

一批 feature 已经写好（见 [requirement-author]），需要排成可执行的 sprint 时。

> feature 粒度标准见 **feature-writing**；本 skill 讲「怎么切、怎么排、怎么并行」。

---

## 切 sprint 的启发式

| 原则 | 说明 |
|------|------|
| **一个 sprint = 一个可交付的连贯目标** | 不是「这周能做多少塞多少」，而是「做完能验证出一个完整能力」 |
| **按依赖拓扑排序** | 被依赖的 feature 先做；A 的产物是 B 的输入 → A 进更早的 sprint |
| **同 sprint 内尽量解耦** | 同 sprint 的 feature 之间最好无强依赖，方便并行与独立验证 |
| **优先级 + 风险前置** | 高风险/高不确定的 feature 早做，早暴露问题 |

---

## 依赖与并行处理

1. **画依赖**：列出 feature 间的「谁依赖谁」。有环 → 需求没切干净，回 requirement-author。
2. **分层**：无依赖的进第一层，可并行。
3. **并行靠 owner**：同一 sprint 内要并行时，用 owner 字段分给不同 agent，
   每个 owner 各自最多一个 in_progress（见 [feature-implementer] 的 claim 流程）。

### 多 agent 并行分派纪律（实战教训，必查）

- **同文件热点串行化**：两个 feature 会改**同一个文件**（尤其共享页面/共享 spec）时，
  不得同 wave 派发——必须等前一个 PR 合并后再派下一个。派发前先比对各 feature
  预计触碰的文件清单，有交集即串行。
  （反例：两个 PR 并行改同一 `rooms/page.tsx`，后合者被迫返工。）
- **合并顺序按"动共享 spec 多的最后合"**：并行 wave 收尾时，改共享测试/spec 文件
  最少的 PR 先合，动共享 spec 最多的最后合，把 rebase 冲突集中到一处。
- **认领走 coord-service**：分派时用 `harness claim`（+ 需要跨会话唯一性时用
  `module-lock-acquire`/`heartbeat`）落地认领——multi-agent-coordination.md §4 讲的
  "issue label 双写 + lease 评论刷新"是 ADR-009（2026-07-08）之前的旧机制，该文件
  顶部已标注"仅作历史记录保留"，不要照它当前有效的操作指令执行；issue label 只是
  状态的只读投影。

---

## 落地命令

```bash
# 切一个 sprint，并把 feature 分配进来
pnpm harness new-sprint --phase <NN> --id <MM> --goal "<连贯目标>" --features F01,F02

# 已 passing 的 feature 不会被重新分配（passing 归属不可变，命令会自动跳过并告警）
```

`new-sprint` 会：
1. 把指定 feature 的 `sprint` 字段写进 `feature_list.json`（唯一权威来源）。
2. 派生 `active-features.json`（只读视图，**禁止手改**）。
3. 生成 sprint 目录骨架（progress / handoff 模板 + `evidence/`）。

---

## 产出后

每个 sprint 同一时刻只推进一个（或每 owner 一个）in_progress feature。
实现交给 [feature-implementer]，验证走 `pnpm harness verify --sprint <NN>/<MM>`。
不要在这里手改任何状态字段。

---

## 能力清单（这个 skill 让你具备的可执行动作）

- 从一批未排期的 feature 出发，产出一个可执行的 sprint 划分：分层（拓扑序）→
  同层内并行标注（owner 分配）→ `new-sprint --features` 落地。
- 识别依赖环：画依赖表时如果出现环，判定为"需求没切干净"，退回
  requirement-author 而不是强行拆环。
- 识别并行冲突：派发前比对候选 feature 预计触碰的文件清单，同文件热点必须
  串行化，不管依赖图上是否有边（见下方"多 agent 并行分派纪律"，这是依赖图之外
  的第二道检查，图上无环不代表可以安全并行）。
- 判断"该不该新开一个 sprint 还是把 feature 塞进当前 sprint"：看是否构成
  "一个可交付的连贯目标"，不是按人力余量凑数量。

---

## 架构知识：这个 skill 在 harness 工具链里的位置

```
feature_list.json（阶段权威，requirement-author 产出）
        │
   ★ 本 skill：读依赖 + 优先级字段，决定分层与归属 ★
        │
new-sprint --features F01,F02
        │
        ├─→ 写回 feature_list.json 的 sprint 字段（改的是权威源，不是副本）
        ├─→ 派生 active-features.json（只读视图，scaffold 时自动生成）
        └─→ scaffold sprint 目录骨架（progress/handoff 模板 + evidence/）
        │
   下游：feature-implementer 认领 in_progress → verify 门控
```

- **输入**：`feature_list.json` 里每个 feature 的 `depends_on`、`priority`、
  `area`、`owner`、`status` 字段——这些字段的 schema 由 requirement-author 定义，
  本 skill 只读不改其定义，只改 `sprint` 归属。
- **产出**：`sprint` 字段的写回 + `active-features.json`（脚本派生，见
  `new-sprint.ts` 里 `writeActiveFeatures`）。**已 `passing` 的 feature 会被
  `new-sprint` 自动跳过重新分配**——passing 归属不可变是脚本强制的，不是纪律。
- **前置门控**：`new-sprint` 内部会先跑 `assertDesignSignedOff(phaseId, assign)`
  ——待分配的 feature 所属契约束必须已在束级 `design-signoff.md` 签核
  （ADR-023），排期排得再好，签核没过一样 `die()`。排 sprint 前先确认目标
  feature 的契约束状态，不要排完才发现开不了工。
- **下游消费者**：`feature-implementer` 读 `active-features.json` 找
  in_progress；`pnpm harness verify --sprint` 读同一份 sprint 归属决定验证范围；
  `github-projector` 的 `sync` 读 sprint 归属决定 issue 该打哪个 `sprint:*` label。

---

## 领域知识：排期启发式背后的调度理论，以及它跟教科书算法的差异

**分层 = Kahn 算法的拓扑分层，不是巧合**：把 feature 依赖图按"入度为 0 先出"
反复剥层，得到的每一层就是"本层内彼此无强依赖，理论上可同层并行"的集合——
这正是 Kahn's Algorithm 做 DAG 任务调度的标准做法。本 skill"按依赖拓扑排序 →
无依赖的进第一层"这条启发式，就是对这个算法的直接应用，只是不需要真的写代码
实现——依赖表通常小到能手工分层。

**风险前置 ≈ 关键路径法（CPM）的简化版，但本仓没有做完整 CPM**：CPM 要计算
每个任务的最早开始/最晚开始/浮动时间（float），找出零浮动的关键路径优先保证。
本仓的"优先级 + 风险前置"启发式只做了 CPM 的第一步直觉（长链条/高不确定的任务
早排），**没有**计算真正的 float/关键路径——因为 sprint 粒度的 feature 数量
通常个位数到十位数，人工判断链条长度的成本远低于建模计算 CPM 的成本。如果某个
阶段的 feature 数量和依赖复杂度显著增长（例如超过 30 个 feature、依赖边超过
一层），值得考虑用 `pnpm harness dep-graph` 生成的依赖图做更严格的关键路径
分析，而不是继续纯人工判断。

**并行度的真实约束是"每 owner 一个 in_progress"，不是"同层可以随便并行"**：
教科书拓扑分层假设资源无限，但本仓的 ADR-001 把并行度硬约束为
"每个 owner 同时最多一个 in_progress"——这相当于给每个 owner 分配了 1 个
"处理器"的资源受限调度（resource-constrained scheduling），同层 feature 数量
超过可用 owner 数时，多出来的会排队而不是同时开工，规划 sprint 时要按 owner
数而不是按"依赖上允许多少并行"来估算真实吞吐。

**同文件热点串行化是依赖图之外的第二道约束**：拓扑图只表达"数据/成果依赖"，
不表达"物理文件冲突"——两个 feature 即使在依赖图上互不相关，只要会改同一个
文件（尤其共享测试/spec 文件），并行做就会有一方返工。这是本仓实战撞出来的
补充规则，教科书调度算法通常不建模这种"隐性共享资源"，需要额外的人工检查。

- 参考来源：[拓扑排序在项目管理中的应用](https://stmcomputers.stmjournals.com/index.php/JoSETTT/article/view/498)、
  [关键路径分析（CPM）综述](https://www.sciencedirect.com/topics/computer-science/critical-path-analysis)、
  [Kahn 算法与 DAG 任务调度](https://saurabhdhingraa.hashnode.dev/topological-sort-taking-graph-theory-to-life)。

---

## 迭代 / 知识回流机制

- 每次撞到新的"依赖图之外的隐性冲突"（同文件热点是第一个已知类型），在
  "多 agent 并行分派纪律"下追加一条，写清判断信号和处理方式，不要只记反例
  不记规则。
- 如果某阶段真的上了严格 CPM/float 计算（不再是人工判断），把方法和触发阈值
  写回本节"领域知识"，替换掉"本仓没有做完整 CPM"这句过期描述——不要留着两份
  互相矛盾的说法。
- 升级状态记录在 `.harness/state/skill-upgrade-backlog.md`（批次 C），单一
  事实源，不在本文件重复维护进度表。
