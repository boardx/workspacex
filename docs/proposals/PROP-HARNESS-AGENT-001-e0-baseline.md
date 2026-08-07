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

## 后续裁决（2026-08-07，人类："对于这些问题，你来决定使用最佳实践"）

H3A-001 人类已签 Yes（无保留接受）。以下几条原本列给人类的问题，人类明确
授权 coord-architecture 按最佳实践自行裁定，逐条记录裁定与理由，不是回避：

**ADR-009/ADR-017 缺文件**——不是断链，是 `docs/adr/README.md` 早就写明的
已知设计边界（上游 BoardX 项目实现层 ADR，未随模板分发）。真正的问题是
40+ 处引用点各自读起来都像指向一个坏链接，读者读到任何一处都发现不了这是
"上游未分发"而不是"文件丢了"。裁定：不发明上游原文，从本仓已有的全部引用
现场取值、综合重建成两份**明确标注"本地重建，非上游原文"**的本地 ADR
（`docs/adr/ADR-009-github-coordination-plane-retirement.md`、
`docs/adr/ADR-017-coord-gateway-repohub-cutover.md`），每条决策点后面挂
真实引用来源；README 索引表同步补两行、更新"编号空洞"说明。选这条不选"保持
现状"的理由：这两份 ADR 描述的决定已经是真实生效的代码行为（D1/coord-gateway
的 claim/heartbeat/TTL 机制不是假设），本地重建只是把"已经在跑的决定"写成
一份可读记录，不是新增决策权威。

**H3A-003 发现的"人类直接合并 vs coord-main 门控合并"落差**——裁定：不改
本提案 §7 权限矩阵去迁就当前的直接合并行为。理由：矩阵本身已经写了"人类可
保留紧急权"这一格，当前的直接合并落在这条已经允许的例外里，不是设计缺口；
把设计改成迁就例外行为，会让"唯一 Agent 合并权"这条本来就写明的治理收益
（producer/reviewer 独立性、exact-SHA gate）名存实亡。维持设计原样，H3A-026
门控按原文实现；如果之后发现人类持续大量直接合并导致 gate 形同虚设，那是
需要重新拿回人类决策的信号，不是现在就该改的信号。

**HMV2-001（Harness V2 是否需要正式 ADR 化）**——裁定：不需要单独的 ADR。
理由：H3A-001 刚刚示范了同一个模式——提案文件头的"状态"字段本身就是可读、
可引用、带日期和原话的签核记录（本文件即决策记录），Harness V2 的
`PROP-HARNESS-MODEL-001.md` 已经有同构的签核记录（"这个是一个解决思路"/
"按照你的建议开始吧"）。为它另写一份 ADR-1xx 是重复声明同一个签核事实，
违反 AGENTS.md 自己"同一事实不得声明在两处"的纪律。checklist 里
HMV2-001 标记为"以提案文件头签核记录为准，不另立 ADR"。

**#633 SLA（5 分钟目标未达成）**——裁定：接受当前基础设施约束下的
~7m53s 作为现状，不再投入工程时间硬压。理由已经在 #633 issue 里实测过：
唯一没试过的杠杆是"假哈希测试"，而那会真的削弱一条已验证的反测试（
`login-enumeration-guard.test.ts` 的反枚举计时断言）；另一条杠杆（第二台
CI runner）是基础设施采购/权限决策，不是我能自己拍板的事。不主动再花
时间追这个数字，除非拿到新的基础设施授权。

**CopilotKit v2 + AG-UI 迁移范围澄清**——裁定：明确延后，不在本轮处理。
理由：coord-main 派工时这条本身就标注"优先级高但不是打断一切级别"，而 H3A
Epic E0 现在有更高杠杆的工作（terminology registry 等 P0 项，见下一步）。
延后不等于遗忘——这条记在这里，下一个空档周期捡回来。

---

实测时间：2026-08-07（现场 `gh`/文件读取，非估算）。
