# PROP-ORG-BRAIN-KG-001：组织大脑 × 知识图谱——现状盘点与落地方案

- 状态：**Accepted（2026-09-24 人类裁决 D1–D7，见第 4 节；方案按裁决改写为「chat session 先行」）**
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

## 3. 方案（按 2026-09-24 裁决改写）

### 3.1 作用域阶梯：chat session 先行，最小闭环验证后再外扩

人类裁决：**先在 chat session（含个人项目）上把向量检索与知识图谱用起来**，在最小场景里做验证闭环，
再逐级扩到项目、组织、乃至 WorkspaceX 平台。所有本体表从第一天就带统一的作用域列，外扩只是放开作用域，不改表：

| 级别 | `scope_kind` | `scope_id` | 何时开放 | 谁能读 |
|---|---|---|---|---|
| L0 | `chat_session` | `chat_threads.id` | **第一期（KG-M1–M4）** | 该会话可见者（沿用 chat 可见性） |
| L1 | `personal` | 用户 id（同一用户全部个人线程，phase-18 S0-2=A） | 第一期末 | 本人 |
| L2 | `project` | `projects.id` | 第二期（接 09-kg 现场协作） | 项目角色（RLS） |
| L3 | `org` | `organizations.id` | 第三期（14-brain 组织大脑） | 组织角色 + 五态机 + 脱敏闸门 |
| L4 | `platform` | —— | 另议（平台大脑 dogfood，`super-instance-design.md` D17） | —— |

**晋升 = 跨级写入**：低一级的 claim/object 只有经过对应闸门（L0→L1 本人确认；L1/L2→L3 组长确认 + D-32 准入）才会在
高一级生成新行，并用 `derived_from` 边连回原行——**不改原行的作用域**，来源链不断（uc-7-4 L121）。

### 3.2 数据模型（canonical 仍是 PG 关系表 + RLS；AGE 与 pgvector 是可重建投影）

| 表 | 动作 | 要点 |
|---|---|---|
| **`ontology_objects`**（新建） | 实体节点：人、项目、决策、需求、研究、概念、术语、组织单元……（封闭枚举 `object_kind`） | 带 `org_id / scope_kind / scope_id / privacy / confidence / review_state / valid_from / valid_to / created_by / provenance_event_id`；RLS 按 org + scope |
| **`claims`**（扩列） | 补 `confidence / valid_from / valid_to / created_by / reviewed_by / supersedes_claim_id` + `claim_kind`（假设/证据/概念/决定/方法/教训）+ `decision_state`（O-25 七态，仅 `claim_kind=决定/选项` 可非空）+ `scope_kind / scope_id` + `revoked_at / rejected_at` | **只有一个生命周期状态字段 `status`**；`decision_state` 是 O-25 已裁决的独立决策位置字段，不是第二套生命周期 |
| **`ontology_edges`**（扩列） | `src_kind/dst_kind` 加 `object`、`claim`、`chat_message`；`relation` 分两个封闭枚举：claim↔claim 五类（uc-9-1）、结构类（`mentions / about / derived_from / supersedes / belongs_to / decided_by`）；加 `status(active/invalidated) / confidence / created_by / provenance_event_id / scope_kind / scope_id` | `invalidateOntologyEdges` 改为软失效（与契约一致），不再硬删 |
| **`ontology_actions`**（新建） | append-only 动作日志：谁 / 何时 / 什么操作 / 置信度 / 依据链接 / 结果 | **agent 与模型不直写本体表**，只提交 action，由 application 层执行器校验后落表；与 `provenance_events` 双写同一事务（审计链不断） |
| **`object_embeddings`**（新建，分区方式同 `segment_embeddings`） | 实体与 claim 的向量 | 按 model/version 分区，维度由 `embedding_models` 登记校验 |
| `segment_embeddings` | 已有 | **加 HNSW 索引**（见 3.4 的召回率门） |
| `context_nodes` | **不建** | 该名字只属于 harness 元本体；产品侧的「上下文节点」就是 `segments` + `ontology_objects`，不另起同义表（同一事实不在两处） |

### 3.3 Apache AGE（D1 裁决：现在就上）

- **镜像**：自建 `infra/postgres/Dockerfile`，基于 `pgvector/pgvector:pg16` 编译安装 Apache AGE（PG16 分支，锁 tag），
  `docker-compose.dev.yml` / `docker-compose.deploy.yml` / CI 服务容器统一换成该镜像；锁 PG 大版本。
- **迁移**：`CREATE EXTENSION age`；每个 org 一张图（`wsx_org_<id>`），图名由 org id 派生——**租户隔离靠图边界**，
  因为 AGE 的图内部表不受我们的 RLS 策略覆盖。应用角色（非 owner）只授权到本 org 的图，由连接时 `SET search_path` 限定。
- **投影同步**：`ontology_objects/claims/ontology_edges` 的写入经 PG outbox 发 `graph.project` 任务，worker 幂等 upsert 到 AGE；
  提供 `pnpm --filter api graph:rebuild --org <id>` 全量重放脚本。**AGE 只是可重建投影，不是事实源。**
- **读路径**：openCypher 做 k-hop 邻域 / 路径查询，但**结果只返回 id**，再回 canonical 表按 RLS 取行——
  这样权限永远由 PG RLS 判定，AGE 查询即使越界也拿不到内容。
- **不可用时**：显式报「图检索不可用」并在 Context Pack `omissions` 里记一条，**不静默降级**；
  递归 CTE 保留为测试基线（与 AGE 结果对拍），不作为线上兜底。
- **需同步修订的文档**：`.harness/instructions/architecture.md:26`、`context-engine.md` §六/§七、uc-7-4 L214、uc-14-6 L26
  都写着「阶段一不启用 AGE」——在 KG-M0 用一份 **ADR-114「启用 Apache AGE 作为本体图投影」** 取代，再把这几处改为引用该 ADR。

### 3.4 检索（D2 裁决：混合方式）

保持 query-planned hybrid：FTS + pgvector + 图（AGE）+ metadata + claim 五路并行，RRF 融合，图只给加分、不单独决定结果。
第一期新增的具体工作：
1. **向量**：`segment_embeddings` 与 `object_embeddings` 加 HNSW；上线前必须让 `pgvector-permission-recall.test.ts`
   改为「带权限过滤的召回率 ≥ 阈值」断言（开启 `hnsw.iterative_scan`），不能因为加索引而放掉这道门。
2. **图种子**：实体解析（mention → `ontology_objects`）产出 `graphSeeds`，移除 `hybrid_graph_seeds_unavailable`。
3. **chat 接入**：`StandardContextService` 的 `organization-hybrid` 作用域增加 `chat_session` / `personal` 两级；
   Deep agent 每轮取 Context Pack，claims 与图路径作为 `retrievalReasons` 可见。

### 3.5 三态 ↔ 七态 ↔ 五态统一对照表（D5：建议方案，待人类确认后写进契约束）

O-25 已裁决「证据三态 ↔ 决策七态」映射（uc-9-2 R10）；uc-14-5 R10 已给「业务五态 ↔ `claims.status`」。
两张表从来没放在一起，这里合成一张，**作为契约束 `domain.md` 的唯一版本**，两份 UC 改为引用它：

| `claims.status` | 派生条件 | 证据视角三态（09-kg） | 知识五态（14-brain） | 决策七态 `decision_state` 允许集 |
|---|---|---|---|---|
| `proposed` | `rejected_at` 空 | 待确认 | 候选 | 待验证 / 待决 / 建议 |
| `proposed` | `rejected_at` 非空 | 不渲染 | 驳回（终态） | 已否决 |
| `reviewed` | —— | 待确认 | 已验证 | 待验证 / 待决 |
| `accepted` | `now < valid_from` | 已确认 | 已批准 | 领先 / 在议 / 已否决 |
| `accepted` | `valid_from ≤ now < valid_to` | 已确认 | 生效 | 领先 / 在议 / 已否决 |
| `accepted` | `now ≥ valid_to` | 已确认（过期角标） | 待复核（不计定题强度，D-33） | 领先 / 在议 / 已否决 |
| `contested` | —— | 冲突 | 生效 · 存在冲突（成对召回） | **冲突**（双向恒等） |
| `superseded` | 有后继 | 不渲染 | 被替代 | 保持原值只读 |
| `superseded` | `revoked_at` 非空 | 不渲染 | 被撤销（反例资产） | 保持原值只读 |

补充规则（建议）：
- `建议` 只允许 `created_by = model`；AI 身份写其余六态一律拒绝（与 F16「决策节点 AI 不可写入」同一校验）。
- `已否决` 必须同时有判定依据 + 判定时间（uc-9-2 R3）。
- chat session（L0）默认只用三态，不启用七态与五态；七态在 L2 项目开放，五态在 L3 组织开放——**字段一开始就在，只是按作用域放开校验**。

### 3.6 到期规则（D6 裁决：抽成共享复核调度）

新建 `apps/api/src/domain/review-schedule/`（纯函数：到期判定、宽限、提醒节奏）+ `application/review-schedule/`
（PG job table 扫描器）。知识（`claims.valid_to`）与资产复核（23-asset uc-23-6）都调用它；
关闭 `23-asset/OPEN-QUESTIONS.md` Q-7。

### 3.7 里程碑（D7：按建议，但以 chat session 为第一闭环）

| 里程碑 | 内容 | 验收门（机器可验） |
|---|---|---|
| **KG-M0 设计与签核** | ① ADR-114（AGE）+ 修订 architecture.md / context-engine.md / CONCEPTS.md；`knowledge-ontology.md` 标明「仅限平台大脑 / harness 元本体」（D3，由我定：标注，不改名）；② 新需求 `requirements/…/uc-kg-0-chat-session-知识图谱.md` 交 requirement-author 生成 feature；③ 契约束 `contracts/knowledge-graph/`（ui / usecases / domain 含 3.5 对照表 / coverage / `packages/contracts/src/chat-knowledge-graph.ts` / design-signoff） | 人类签 design-signoff 与 design-coherence |
| **KG-M1 底座** | AGE 镜像 + 迁移；`ontology_objects` / `ontology_actions` / `object_embeddings` 新建；claims、ontology_edges 扩列；HNSW；`invalidateOntologyEdges` 真实现 | `migrate:check` 重放；RLS 审计；`graph:rebuild` 后 AGE 与 CTE 对拍一致；带权限过滤召回率测试 |
| **KG-M2 chat 入图** | 对话消息与上传文件 → 实体/claim 抽取（模型提交 `ontology_actions`，执行器落表）→ AGE 投影 → 向量 | real-db：同一消息重复处理不产生重复对象；模型身份直写本体表被拒 |
| **KG-M3 chat 检索闭环** | chat 回答走 hybrid 五路（含 AGE 路径 + 向量），Context Pack 带图路径与引用；会话侧栏「本会话知识图谱」只读视图（`@xyflow/react`） | e2e：会话里说过的事实，在后续提问中被召回且引用可点回原消息；跨会话/跨用户泄漏为零 |
| **KG-M4 个人空间** | L1 作用域 + 会话→个人空间的确认晋升 | e2e：确认后在同一用户的新个人会话里可召回 |
| **KG-M5 项目现场（09-kg）** | F11–F19：入图管道（画布/研究/访谈）、三态、批量确认写回、决策树七态 | 各 UC R7 验收 |
| **BRAIN-M6 组织大脑（14-brain）** | F16–F36：五态机、决策台账、检索可审查、写回去重、跨项目调用、沉淀 → skill；复核调度 | 各 UC R7 验收 |
| **L4 平台** | 另立提案 | —— |

**顺序硬约束**：M0 → M1 → M2 → M3 是第一个可演示闭环（「在 chat 里说过的东西，AI 之后能用图 + 向量找回来并给出引用」），
不可跳；M5/M6 复用 M1 的表，不另建。

---

## 4. 人类裁决记录（2026-09-24）

| # | 问题 | 裁决 |
|---|---|---|
| D1 | 图存储 | **现在就上 Apache AGE**；pgvector 向量查询同时上。场景从个人项目 / chat session 起步做最小闭环，再扩到项目、组织、平台 |
| D2 | 检索策略 | **混合方式** |
| D3 | `knowledge-ontology.md` | 交由方案决定 → 标注为「平台大脑 / harness 元本体专用」，产品侧指向 context-engine.md 与本提案；不改名 |
| D4 | `ontology_objects` | **现在就建**（组织大脑需要的都现在建起来） |
| D5 | 三态↔七态对应表 | 由方案提出建议 → 见 3.5，待契约束签核时确认 |
| D6 | 到期规则 | **抽成共享复核调度**，知识与资产共用 |
| D7 | 先做哪边 | 按建议 → chat session 闭环先行（M0–M4），再 09-kg，再 14-brain |

## 5. 下一步

1. 本提案合入后，开 KG-M0 的第一个 PR：ADR-114 + 上述文档修订（纯文档）。
2. 第二个 PR：chat session 知识图谱需求文档 + 契约束草案，推人类签核。
3. 签核后领 KG-M1，走标准 feature → issue → 分支 → verify → PR 流程。

> 本提案本身不改任何 feature 状态、不写实现代码。
