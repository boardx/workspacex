# PROP-ORG-BRAIN-KG-001：组织大脑 × 知识图谱——现状盘点与落地方案

- 状态：**Draft——等人类裁决第 4 节 D1–D7 后转 Accepted**
- 起草：2026-09-24，Claude Code 会话（分支 `claude/org-brain-knowledge-graph-plan-fjqb8m`）
- 范围：**产品域「组织大脑」**（客户把产出物沉淀进本组织知识库，`brain-promotion`）。
  **不是**「平台大脑」/ harness 元本体（`docs/architecture/knowledge-ontology.md`、`.harness/scripts/lib/graph-*`），
  叫法以 `.harness/instructions/project/PROJECT.md`「词汇单一事实源」为准。
- 目标架构：`docs/architecture/context-engine.md`（2026-07-28 定稿）——本提案**不推翻它**，是它 P3「知识与图谱」
  + P5「组织大脑」两段的落地计划，承接 `PROP-CONTEXT-ENGINE-001`（该提案给 P3 = 0.5/2、P5 = 0/2）。

---

## 1. 一句话结论

**底座已有、图谱层为零、而且现在不能直接写代码。** 检索五路（FTS / pgvector / metadata / claim / 图 CTE）、
`claims` / `claim_segments` / `ontology_edges` 三张表、Context Pack、引用资格门控都已真实存在；但生产代码里
**没有任何一行写 `claims` 或 `ontology_edges`**，图通道因为没有种子实体而事实上关闭，`/brain` 页面全是 mock。
而需求侧 09-kg（phase-02，9 个 feature）与 14-brain（phase-03，21 个 feature）**都没有契约束**，
按 ADR-023 设计签核门，**第一步必须是出契约束 + 人类签核**，不是写迁移。

---

## 2. 现状盘点（exact tree = `8c47faa`）

### 2.1 已有且可复用

| 能力 | 位置 | 备注 |
|---|---|---|
| pgvector + 嵌入注册/写入 | `apps/api/migrations/0009-f10-retrieval-index.sql`；`pg-artifact-index-writer.ts`；`langchain-embedding-client.ts` → Python `retrieval_embeddings.py` | 无 ANN 索引（精确扫描，`pgvector-permission-recall.test.ts` 守着权限过滤召回率） |
| 五路召回 + RRF + rerank | `apps/api/src/{domain,application,infrastructure}/retrieval/` | 图通道 = `pg-segment-retriever.ts:181-211` 的 `WITH RECURSIVE`，深度 2，固定加分 |
| `claims`（五态 status）+ `claim_segments`（supporting/contradicting 同表） | `0009:325-360` | 只有 `status`，缺 context-engine 规定的其余 6 个生命周期字段 |
| `ontology_edges` | `0009:302` | 极薄：无 status/confidence/provenance；`src_kind/dst_kind` 被 CHECK 写死为 person/project/decision/requirement/research/segment，**不含 claim** |
| Context Pack（构建/pin/重放/引用校验） | `apps/api/src/application/context-pack/*` | 已签核 phase-00 `context-pack` 束；`ClaimRef`、I-12 反对证据不可筛除 |
| 引用资格门控（`graph-writeback` / `brain-promotion` purpose） | `0012-f07-downstream-references.sql`；`contracts/src/artifact.ts:104` | 只能引用 pinned 版本（I-14） |
| 删除级联登记 `ontology-edges` / `pgvector` | `20260801210000_f45_deletion_cascade.sql:155`；`pg-deletion-repository.ts:144`（按 segment 硬删边） | |
| 访谈洞察真实落库 | `interview_insights`（`20260820090000_f01_insight_write_path.sql`）+ controller | 之后**没有**进 `claims` |
| Agent 取上下文工具 | `standard_context_tools.py` → `StandardContextService` → `organization-context-source.ts` | 只覆盖上传文件 |

### 2.2 只有契约 / 纯函数 / 桩

| 能力 | 位置 | 缺什么 |
|---|---|---|
| 画布回流：`confirmNode` / `mergeIntoPlenaryGraph` / `batchConfirmAndWriteBackToBrain` / `getNodeProvenance` | 契约 `contracts/src/canvas.ts:1655-1720`；纯函数 `apps/api/src/domain/canvas/backflow.ts`（头注明写"09-kg/14-brain 无存储层"）；测试 `only-lead-confirmed-writeback.test.ts` 等 | 无 controller、无存储 |
| 研究结论晋升 `promoteConclusionToInsight` | `domain/research/promote-insight.ts`、契约 `research.ts:1366` | `persistInsight/persistBackflow` 无实现 |
| `invalidateOntologyEdges` 出站端口 | `contracts/src/files.ts:271-280`；`files-outbound-stubs.ts:88-115` | 永远抛 `CASCADE_TARGET_UNAVAILABLE`；且契约说"置 status=invalidated"，**表里没有 status 列** |
| 图通道种子 | `retrieve-candidates.ts:135` `graphSeeds`；`organization-hybrid-retrieval.ts:17` 抛 `hybrid_graph_seeds_unavailable` | 实体解析不存在 |
| 方法晋升生成 skill | 接收端 `receive-promoted-skill.ts` 已有 | 发送端（14-brain）缺 |
| `/brain` 页面 | `apps/web/app/brain/page.tsx` + `components/brain/*`（总览/分层/决策台账/决策链/Context Pack/工作台） | 全部 `lib/mock/brain.ts`，零 API |

### 2.3 完全缺失

`ontology_objects` / `ontology_actions` / `context_nodes`（只在 harness 元本体文档里）、`provenance_events`
之外的 claim 动作日志、实体/关系抽取、决策树模型、知识图谱可视化（`@xyflow/react` 已装，只用在 agent 能力图）、
写回队列、有效期/复核调度。

### 2.4 需求与 feature（全部 `not_started`、无 owner）

| 模块 | UC | feature | 点数 |
|---|---|---|---|
| phase-02 `09-kg`（M9） | uc-9-1 节点实时入图 / 9-2 决策树与岔口 / 9-3 下一步工作 / 9-4 推演流水线 / 9-5 批量确认与写回 | F11–F19（+ 相关 F29、F37、F42） | 32 |
| phase-03 `14-brain`（M14） | uc-14-1 写回去重 / 14-2 跨项目调用 / 14-3 方法与教训沉淀 / 14-4 决策台账 / 14-5 五态机与晋升 / 14-6 检索可审查 | F16–F36 | 52（D-24 MVP = 14-4 + 14-5 + 14-6 = 34） |
| 上游已 passing（接收端/桩） | uc-7-4 画布回流、uc-22-4 删除传播、uc-3-5 方法晋升、phase-00 F07/F09 | phase-01 F107/F47/F67 | — |
| 下游被阻塞 | phase-10 `stage-aggregation`（F09/F10）`domain.md` 写明**硬阻断于 phase-02 知识图谱契约束签核** | | |

已裁决、实现必须服从的决策：D-24（MVP 三件）、D-30（引用不可变快照）、D-32（晋升严格准入）、D-33（过期转待复核、
仍检索、不计定题强度）、D-16/D-18（脱敏与管理员只见计数）、O-25（定题强度 = 独立来源支持数 − 反对数）。

### 2.5 现存文档冲突（开工前必须先收敛——"同一事实不得声明在两处"）

1. `knowledge-ontology.md` 仍写 graph-first + AGE 必需 + "AGE 不可用不许降级"，与 `architecture.md:26`、
   `context-engine.md` §四/§六、uc-7-4 L214、uc-14-6 L26（hybrid + recursive CTE、阶段一不启用 AGE）矛盾；
   `docs/CONCEPTS.md` L96/L107 仍把它称作"组织本体/知识图谱的完整数据架构"，会把产品工作导向错误文档。
2. 两套模型都叫 `ontology_objects/ontology_edges`，却声称"不共用表"。
3. 状态字段：uc-14-5 R10 禁止第二个状态字段；09-kg 决策七态（O-25）又要求三态↔七态映射表——**映射表 O-25 明确
   "由 09-kg 在实现前给出，不许实现者推断"**，目前不存在。
4. `invalidateOntologyEdges` 契约语义（软失效 status）≠ 现状实现（按 segment 硬删）。
5. 资产复核到期与知识到期"必须同一段实现"，住处未决（`23-asset/OPEN-QUESTIONS.md` Q-7）。

---

## 3. 方案

### 3.1 数据模型立场（推荐，等 D1/D3 确认）

**组织大脑 = 经审核、带有效期、可追溯到证据的 Claim 网络**（context-engine §一）。据此最小改动：

- **节点 = `claims`**：补齐 6 列 `confidence / valid_from / valid_to / created_by / reviewed_by / supersedes_claim_id`，
  新增 `kind`（假设/证据/概念/决定/方法/教训——封闭枚举）与 `origin`（来源组、来源模块），**不新增第二个状态字段**；
  "待复核"= 查询时由 `valid_to` 派生（uc-14-5 R10）。
- **节点↔证据 = `claim_segments`**（已有，stance 同表）；uc-9-1 的溯源四元组从 `segments/anchors` + `provenance_events` 派生，不冗余存。
- **节点↔节点 = `ontology_edges` 扩列**：`src_kind/dst_kind` 加 `claim`；`relation` 在 claim↔claim 间收紧为 uc-9-1 五类封闭枚举；
  加 `status`（active/invalidated）、`created_by`、`provenance_event_id`。**不加 weight**（0009 注释：权重会让图决定结果）。
- **写入纪律**：agent/模型不直写三张表——一律经 application 层用例，并追加 `provenance_events`（已有表）作为动作日志；
  不另造 `ontology_actions`。`ontology_objects` **本期不建**（人/项目/决策已是各自领域表，边用 kind+id 指过去即可），
  等 P5 实体抽取有真实需求再议。
- **图查询**：继续 `ontology_edges + recursive CTE`，不上 AGE（D1）。
- **检索**：继续 query-planned hybrid，图只给固定加分；本期要做的是**实体解析产出 graphSeeds**，让图通道真正打开。

### 3.2 里程碑（每个都按 harness 流程：feature → issue → 分支 → verify → PR `Closes #N`）

| 里程碑 | 内容 | 对应 feature | 验收门（机器可验） |
|---|---|---|---|
| **KG-M0 设计签核**（阻塞一切） | ① 收敛 2.5 的文档冲突（knowledge-ontology.md 标注仅限 harness、CONCEPTS.md 改指向）；② 新建契约束 `phases/phase-02-visible-outcomes/contracts/knowledge-graph/`（ui.md / usecases.md / domain.md / coverage.md / `api.contract.ts` in `packages/contracts/src/knowledge-graph.ts` / design-signoff.md），含 O-25 三态↔七态映射表；③ 扩 phase-02 `design-coherence.md` 的 `covers_bundles`；④ 需要时让 ui-prototyper 补"事实关系/决策树"原型图 | （设计工作，不占 feature） | 人类在 design-signoff.md 与 design-coherence.md 签 `confirmed`；`lint` 契约单源门控绿 |
| **KG-M1 存储与领域模型** | 迁移：claims 补 6+2 列、ontology_edges 扩列与 kind；domain 层封闭枚举 + 不变量；`invalidateOntologyEdges` 真实现替换桩（软失效，删除级联 5 分钟内） | F11、F14 | `migrate:check` 重放绿；RLS 审计绿；删除后边/claim_evidence 可验证失效（context-engine 首批门槛 ④） |
| **KG-M2 入图管道** | 三条上游写入：画布 `confirmNode/mergeIntoPlenaryGraph` 落库 + 路由；研究结论 `promote` 持久化；访谈洞察 → claims；同一事实多组合并去重；三态判定、冲突成对召回、反对证据不可删 | F12、F13 | real-db 测试：同源重复写入不产生重复 claim；contradicting 边删除被拒 |
| **KG-M3 批量确认与写回** | `POST /canvas/projects/:projectId/brain-writeback` 实现：组长确认=唯一写回资格、异步幂等写回队列（PG outbox）、冲突未解拦截、来源链断即拒 | F18、F42 | e2e：组长确认 → 写回 → Context Pack 可引用到该 claim |
| **KG-M4 图检索打开** | 实体解析产出 graphSeeds → 去掉 `hybrid_graph_seeds_unavailable`；claims 进 Context Pack；Agent 工具 `organization-hybrid` 带上 claim | （09-kg 属 F12/F13 的检索半边；若拆需新增 feature，走 requirement-author） | 检索测试集覆盖精确词/语义/关系/时间/反证（首批门槛 ⑤）；跨租户泄漏为零（②） |
| **KG-M5 可视化** | "事实关系"列表 + 15 秒增量刷新；`/brain` 页面从 mock 切 API；图谱视图用已装的 `@xyflow/react` | F12 的 UI 半边、F19 | Playwright 真栈截图 vs 签核原型（rev-uiux） |
| **KG-M6 决策树** | 决策七态、岔口、AI 不可写入决策节点闸门、下一步可开展的工作派发 | F15、F16、F17 | 服务端拒绝 AI 身份写决策节点的测试 |
| **BRAIN-M7（phase-03，D-24 MVP）** | 需先出 `phases/phase-03-reuse-and-governance/contracts/org-brain/` 契约束并签核；五态机与晋升（D-32/D-33、脱敏两级闸门、样本量下限）、决策台账（拍板栏只能是人）、检索可审查（omissions、反对证据强制保留、Context Pack 重放） | F16–F30 | 同上各 UC R7 验收 |
| **BRAIN-M8（phase-03 余量）** | 写回去重 + 冲突三出口、跨项目纵/横调用（"未沉淀"引用 + RLS）、方法与教训沉淀 → 生成 skill（接上已有接收端） | F31–F36 | |

**顺序硬约束**：M0 → M1 → M2 → M3 是写入链，不可跳；M4 必须在 M2 之后（没有 claim 数据时打开图通道只会测空图）；
M5 可在 M1 契约就绪后与 M2 并行做前端；phase-03 的 BRAIN 系列等 phase-02 的 M1–M3 合入后开工（14-brain 的五态机
直接复用 M1 的 claims 字段，先做会造出第二套状态）。

### 3.3 估算

09-kg 需求侧 32 点 + 14-brain 52 点 = 84 点，另加 KG-M0 设计与 M4 检索打通（需求里未单列，估 8–13 点）。
按单一 worker 串行，M0–M3 是第一个可演示的闭环（"组长确认 → 写回组织大脑 → AI 回答能引用它"）。

---

## 4. 待人类裁决（A/B/C 打包，见 `human-decision-packaging.md`）

| # | 问题 | 选项 | 推荐 |
|---|---|---|---|
| **D1** | 图存储 | A. `ontology_edges` + recursive CTE（与 architecture.md 一致）；B. 现在就上 Apache AGE（自建镜像、锁 PG 版本） | **A** |
| **D2** | 检索策略 | A. query-planned hybrid，图只给固定加分（context-engine 现行）；B. graph-first | **A** |
| **D3** | `knowledge-ontology.md` 怎么处理 | A. 标明"仅限 harness 元本体"，删掉产品向措辞，`CONCEPTS.md` 改指 context-engine.md；B. 改名为 `harness-meta-ontology.md` 并连动所有引用；C. 不动 | **A**（B 可后续） |
| **D4** | 产品侧要不要 `ontology_objects` 表 | A. 本期不建，claims 当节点、边用 kind+id 指领域表；B. 现在就建统一实体表 | **A** |
| **D5** | O-25 三态↔七态映射表 | 需要人类给出或确认 M0 契约束里的草案（O-25 明文禁止实现者推断） | 由 M0 出草案，人类签 |
| **D6** | 知识到期与资产复核到期共用实现放哪（Q-7） | A. 放 `domain/claims`（知识侧），资产复核调用它；B. 放资产治理侧；C. 抽共享 `domain/review-schedule` | **C** |
| **D7** | 先做哪边 | A. phase-02 09-kg 写入链先（M0–M3），再 14-brain；B. 直接做 14-brain D-24 MVP | **A**（B 会先造出没有写入来源的大脑） |

---

## 5. 下一步（D1–D7 裁决后立即执行）

1. 开 tracking issue「组织大脑 × 知识图谱落地（PROP-ORG-BRAIN-KG-001）」，每个里程碑挂 sub-issue。
2. 执行 KG-M0：先交文档收敛 PR（D3），再交 `contracts/knowledge-graph/` 契约束草案 PR，推人类签核。
3. 签核后按 `pnpm harness new-sprint --phase 02 ... --features F11,F14` 领 M1，`harness sync --apply` 建 issue，照常开发。

> 本提案本身不改任何 feature 状态、不写实现代码。
