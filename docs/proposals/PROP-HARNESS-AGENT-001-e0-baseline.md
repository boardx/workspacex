# H3A-003 / H3A-005 — 协调流基线 + 与 ADR-010/Graph/HMV2 职责交叉表

> Epic E0 交付物。方法：`gh` 对真实 PR/issue 数据现场取值，不是估算；
> ADR-010 对照直接读该文件原文，不转述。实测时间见文末。

## H3A-003：当前协调流基线

### 实测（`gh pr list`/`gh issue list`，2026-08-07 现场取值）

| 指标 | 数值 | 样本 |
|---|---|---|
| merged PR flow-time（创建→合并）中位数 | **0.67h** | 最近 50 个已合并 PR |
| merged PR flow-time p90 | **9.83h** | 同上 |
| flow-time 最小/最大 | 0.07h / 18.46h | 同上 |
| 当前 open PR 数 | **4** | #650/#644/#578/#433 |
| open PR 最老年龄 | **73.4h**（#433，docs(skills) Garden advisor pack） | |
| open PR p90 年龄 | 73.4h（样本仅 4，p90≈最老那条） | |
| open PR 年龄中位数 | 43.2h | |
| open issue 数 | **71** | |

### 🔴 意外发现，比"基线数字"更重要：GitHub 原生 review 机制没有被使用

抽查最近 15 个已合并 PR（#634~#667 区间），**全部 15 个 `reviews` 数组为空**
（`first_review: null`）。追查 #645（本会话自己那条）：PR 本身零 label、零
review、零 timeline 事件；关联 issue #627 上也没有 `review:*` verdict label。
`mergedBy` 字段显示——继续抽查另外 6 个（#634/#636/#640/#641/#649/#653）——
**7/7 全部由人类（`usamshen`）直接合并**，不是通过 `coord-main` 的
`pr-queue.ts` 门控走 attended 流程。

**这不是在批评谁做错了**，是如实记录：`coordinator-sop.md` 与
`pr-queue.ts` 设计的"coord-main 攒够 exact-SHA review + verdict label 才
授权合并"流程，与今晚（乃至这段抽样窗口）的**实际操作**之间有真实落差——
人类在高吞吐量下选择了直接合并，跳过了这道设计中的门。

这条发现直接喂给下面的 H3A-005：新 Proposal §7 权限矩阵写"合并 PR | 人类可
保留紧急权 | ✅ 唯一 Agent 权限"——如果人类的"紧急权"实际上是**常态**而不是
例外，这条设计假设本身需要在人类 Go/No-Go 决策时被摆到台面上，而不是被
新模型默默继承一个不成立的前提。

## H3A-005：与 ADR-010 / Graph Kernel / Harness V2 职责交叉表

| 关注面 | ADR-010（已接受） | Graph Kernel（PROP-HARNESS-GRAPH-001，PR #642 已合） | Harness V2（PROP-HARNESS-MODEL-001，E1 已合） | PROP-HARNESS-AGENT-001（本提案，Proposed） | 权威归属判定 |
|---|---|---|---|---|---|
| 角色层级（三级） | **原始决策**：coordinator/module-coordinator/子 agent 三级 + 边界表 | 不涉及 | 不涉及 | **细化**：改名 Root/Domain/Specialist，加 layer/dispatch/authority 字段变成可校验 schema（TPL-ROL-001） | ADR-010 是决策权威，本提案是它的**可执行化**，不是竞争决策——ADR-010 正文第 133 行"备选已否决"没有变化 |
| 子 agent 自动登记 | **已承认差距**：`docs/adr/ADR-010-agent-org-model.md:104-110` 原文——"运行时经 Agent 工具派生的子 agent尚未自动写入 D1"，明确留给"后续 architecture-coordinator 与 coord-main 的协作实现项" | 不涉及 | 不涉及 | **正是这个差距的实现计划**：H3A-040/041（TPL-AGT-001 + dispatch-before-write） | 无冲突，本提案是 ADR-010 自己标注的后续实现，字面对应 |
| per-agent 效率归因 | **已承认差距**：同文件 111-112 行，"cycle-report 目前聚合全局 flow time，尚未按 agent/子 agent 细分归因" | 不涉及 | 不涉及 | H3A-076/077/078（token/cost/time 分层遥测） | 同上，无冲突 |
| 权威数据模型（哪个 writer 拥有哪份事实） | 未定义图/模型层，只有角色边界表 + registry.yaml | **已定义**：Traceability Graph 的编译输入（roadmap + feature_list）、node/edge registry、GraphSnapshot——PR #642 描述"1,181 nodes / 1,554 edges"实测 | **已定义**：Template Registry + InstanceMetadata schema（TPL-\*），本提案要复用的 TPL-ROL-001 等 7 个类型就是 V2 E1 seed 出来的空壳 | §9 Graph Engineering 明确三张图（Traceability/Authorization/Execution）**其中一张（Traceability）已经是 Graph Kernel 的产物，不是待建** | 需要澄清：本提案 §9.1 描述的 Traceability Graph 编译流程与 #642 已交付的 roadmap/feature_list 编译器是不是同一件事——如果是，H3A-070（compiler）里 Traceability 那一半已完成，只剩 Authorization/Execution 两张图待建，backlog 估算应该反映这一点，避免重复立项 |
| Domain Skill / Module Skill schema | 不涉及（ADR-010 没提"知识"层） | 不涉及 | 已注册 `TPL-MOD-001`（Module Knowledge）+ 本会话新增的 `TPL-SKL-001`（Skill Activation Metadata，见 HMV2-002/004，PR #653）——**两者管的是同一批 `SKILL.md` 文件的不同关注面**：`TPL-MOD-001` 管内容体，`TPL-SKL-001` 管激活元数据 | 复用 `TPL-MOD-001`（§8.2），未提及新增的 `TPL-SKL-001` | 无冲突但需要在 H3A-012（Domain Skill schema）落地时显式带上 `TPL-SKL-001` 的存在，否则两个提案的读者会各自以为自己那份是唯一权威 |
| 合并权唯一性 | ADR-004/009——`coord-main` 唯一 | 不涉及 | 不涉及 | §7 矩阵重申唯一性，H3A-026 门控 | **见上面 H3A-003 的实测发现**：设计权威一致，但实测操作已经偏离——不是 schema 层面的冲突，是"设计 vs. 实测行为"的落差，交给人类 Go/No-Go 时一并确认 |

### 结论（不是决定，供人类判断）

1. **没有发现 schema/authority 层面的真实重复声明**——ADR-010、Graph Kernel、
   Harness V2、本提案四者在"谁定义什么"上边界基本清楚，本提案本身就是
   前三者已知差距的实现细化，不是平行发明。唯一需要显式澄清的是 Traceability
   Graph 与 Graph Kernel 的 roadmap/feature_list 编译器是否算同一交付物
   （若是，backlog 里 H3A-070 的范围要相应收窄）。
2. **真正需要人类看到的不是 schema 冲突，是"设计的合并流程"与"实测的合并
   行为"之间的落差**（H3A-003 的意外发现）——这条与本提案 §7 权限矩阵、
   H3A-026 门控直接相关，建议在 H3A-001 人类签核时一并确认："唯一 Agent
   合并权"这条设计，是否要求人类改变当前的直接合并习惯，还是模型本身要
   显式容纳"人类紧急权"为常态路径而不是例外。

---

实测时间：2026-08-07（现场 `gh`/文件读取，非估算）。
