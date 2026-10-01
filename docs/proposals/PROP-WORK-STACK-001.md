# PROP-WORK-STACK-001 — Work Stack（200 Skill / 60 Workflow / 60 Agent）完整解决方案

> 状态：**待人类批准**（未执行任何代码或流程变更）
> 基线：`main@HEAD`（含 #4502）＋ 分支 `requirements/work-stack-320-v1@bf8d8e7d`
> 产品前提（人类 2026-09-28 确认）：**现在的 Agent 就是 DigitalHuman**——不建第二个身份实体。

---

## ⚠ 修订 R1（2026-09-28，人类批准后 main 合入 #4523）

批准后 main 合入了 Work Stack v2（`requirements/work-stack-v2/`），人类随后确认了以下调整。**本节优先于正文中与之冲突的内容。**

| 原方案 | 修订后 |
|---|---|
| D1：需求权威 = main #4502（v1，SK-/WF-/DH-） | **需求权威 = `requirements/work-stack-v2`（S/W/D 编号）**。v1（#4502 的 `phases/requirements/work-stack-v1/`）标记为 superseded，不再作为输入 |
| P3：新建 `composition.yaml` 当组合图 | v2 已有 `WORKFLOW-SKILL-MATRIX.md` 和 `DIGITALHUMAN-COMPOSITION-MATRIX.md`，**以它们为唯一组合图**，不另建副本；新增 lint 检查引用闭合、`skillGaps` 显式登记 |
| P4 / §7：实现时顺带作者化内容 | 按 v2 `AUTHORING-PROTOCOL.md`：**每个实体单独作者化 + 独立评审**，只有 PASS 的实体才能进入实现。作者化由多 agent 工作流分批执行（每批作者 + 评审，人类抽查） |
| 平台是否等作者化完成 | **并行**：v2 明确架构不变，平台底座（6a–6d）先开工；每个实体的内容实现，等它那份文档评审 PASS 后再做 |
| 实时数字人 | 新增**独立轨道**（单独 phase）：按 v2 `realtime-digital-human/IMPLEMENTATION-PLAN.md` 执行，依赖 Agent 扩展（6c），试点角色与 Stage 1 一致（D002 / D003 / D005） |
| 头像（D5） | 未定出图方式，先用插画 key 集占位 |

作者化产出约定（v2 未规定，Phase 0 补上）：
- 实体文档：`requirements/work-stack-v2/{skills,workflows,digital-humans}/<ID>-<slug>.md`
- 评审结论：`requirements/work-stack-v2/reviews/<ID>.review.md`（PASS / REWRITE / SPLIT / MERGE / DELETE + 六项评分）
- 进度：以 `AUTHORING-TASK-MANIFEST.json` 为清单，由脚本从 reviews 目录汇总，不另存状态

---

## 0. 一页结论

1. **需求有两份，必须先收敛成一份。** main 上已有 #4502（`phases/requirements/work-stack-v1/`，SK-/WF-/DH- 编号，Stage 1 = 50/20/10），分支又加了一份（`requirements/work-stack-v1/`，S/W/D 编号，Phase 1 = 60/15/10）。两份的范围、编号、交付物都不同，违反「同一事实不得声明在两处」。**建议以 main #4502 为权威**，分支只吸收它独有的内容（AVATAR-SYSTEM、MANIFEST），分支本身不合入。
2. **平台底座大约 60% 已有，但有 5 个结构性缺口。**
   - 没有通用 Workflow Runtime：只有两个各写各的 LangGraph 实现。
   - Agent 没有头像、分类、Workflow 白名单和委派/升级策略。
   - Skill 没有依赖、溯源、地区、评测元数据。
   - 没有 Eval Runner。
   - 工具只按 `sideEffect` 区分，没有能力分类。
3. **320 份实体规格是模板生成的**：D002 和 D003 只差 12 行，200 个 Skill 只有 4 种长度。组合关系（哪个 Workflow 用哪些 Skill、哪个 Agent 挂哪些 Skill/Workflow）**完全没写**。所以真正的工作量在「内容作者化」，不在平台。
4. **路线：Phase 0 收敛需求 → Stage 1 分 3 段（平台底座 → 3 条试点链路 → 补齐 50/20/10）→ Stage 2 → Stage 3。** 每个 Stage 对应一个仓库 phase（phase-20/21/22）。平台 feature 走一个 issue 一个 PR；内容以「批次 feature」交付。

---

## 1. 现状基线（代码核对结果）

| 能力 | 已有（可复用） | 缺口 |
|---|---|---|
| **Skill** | 包模型 `skills`/`skill_versions`（版本不可变，`manifest jsonb`）；声明式模型 `skill_contracts`（带审核/安全门）；`skills/<pack>/<skill>/SKILL.md` + `skills/starter-packs/*.json` 启动导入（约 22 个平台 Skill）；GitHub/ZIP/URL 导入；`skill_trial_runs` 试跑 | 两套 Skill 模型并存，审核门不作用于包模型；`skill-development.ts` 未签核；没有依赖（工具/MCP/能力）、结构化溯源、locale、评测、分类、废弃/后继字段；sandbox 只能用预装模块 |
| **Agent（=数字人）** | `agents`/`agent_versions`（版本快照、`SNAPSHOT_FROZEN_FIELDS`）；`roleLabel`；技能绑定 = `agent_versions.skill_version_ids`；发布审核、三层权限交集、call-chain（深度 2）、子任务委派；Agent starter-pack 管线（未发任何内容）；3 个代码种子 Agent | 没有头像（只有首字母）；没有角色分类和官方标记；没有 Workflow 白名单；没有「可委派给谁」和升级策略；**starter-pack 契约和 DB CHECK 都强制 `tool_policy` 为空**，要带工具的角色 Agent 没法经包分发；`monthlyCallCount` 恒为 null |
| **Workflow** | 数字访谈（`digital-interview-graph.ts`，PostgresSaver，业务行和 checkpoint 分离，receipt-first，expectedVersion）；引导式研究（节点 receipt 的 begin/finalize 形状，是仓库里最干净的）；pg-boss 定时；`guardAgentInterruptDecision`；先落库再推送的 SSE | 没有通用运行时，两个实现各自重复了 checkpointer、receipt、lease、SSE、projection；research 基础设施反向 import interview 的文件，两者共用 `langgraph_interview` schema；projection 直接读 `channel_values`；在跑实例没有图版本迁移；没有 webhook/事件触发；scheduler 只能唤醒 agent run；Context Pack 绑死在 agent「run」上 |
| **Tool/MCP** | `DiscoveredTool.sideEffect`、按副作用封顶授权、任务授权、服务审核、凭证代理、egress guard | 没有能力/分类体系，没有健康探测 |
| **Context/Org Brain** | `finalizePack`/`gateAiCall`/`verify-citation`；KG 召回和各作用域 reader | phase-18 共 17 个 feature 都还没开工 |
| **Board** | phase-19 在推进（BV01 进行中） | `board.ts` 里没有 agent 参与者对象 |
| **Eval** | `evals/skill-selection`、`evals/ic-review`、deep-agent golden tc1–7、真实模型 e2e lane | 没有通用的 suite/case/grader 模型，没有对比基线，没有发布门 |
| **流程** | phase-20 空闲；phase-15（AI Capability Studio）是空壳（`features: []`）；roadmap 缺 16/17 | Work Stack 和 phase-15 目标高度重叠，要合并或划清边界 |

---

## 2. 需求包本身的问题（开发前必须修）

| # | 问题 | 处理 |
|---|---|---|
| P1 | 两份需求并存（main #4502 和分支） | 以 #4502 为权威；分支的 AVATAR-SYSTEM、MANIFEST 并入；分支关闭不合入 |
| P2 | #4502 写了 `DigitalHumanDefinition/Version`，分支写了 `DigitalHumanProfile`，都是第二身份 | 改成「Agent 扩展字段」（§4.3），出 ADR |
| P3 | 实体之间没有组合关系 | 新增 `composition.yaml`，作为 Skill→Workflow→Agent 引用图的唯一事实源，由 lint 检查引用闭合 |
| P4 | 实体规格是模板，没有专业内容 | 每个 Skill 在实现时写真正的方法（步骤、判定规则、样例、评测 case）。规格文件只保留 ID、范围和策略，不假装完备 |
| P5 | 分支 Phase 1 的试点有 Product Manager，但 S001–060 里没有 Product 技能 | #4502 的 Stage 1（含 Product 和 Support）已修正，采用它 |
| P6 | 溯源只到仓库级 | 每个 Skill 实现时补具体路径、commit 和 artifact 级许可证，G1 门机械检查 |
| P7 | phase-15 空壳和本需求重叠 | 把 phase-15 目标并入 Work Stack，phase-15 标记为 superseded |
| P8 | 通用验收（「G0–G6 通过」）脚本判不了 | 每个 feature 的 verification 写成具体命令，G0–G6 落成脚本（§5） |

---

## 3. 目标拆解

**北极星**：用户在 Workspace 选一个角色 Agent（带头像），把一件真实工作交给它。Agent 组合已发布的 Skill 和 Workflow，在权限和人工审批下把事做完或升级给人，全程有证据、可审计、可回放。

拆成三条可并行的轨道：

```
轨道 A 平台能力（工程，少而关键） ── 决定上限，Stage 1 前半程完成
  A1 Skill 元数据扩展 + 统一目录   A4 Eval Runner + G0–G6 门
  A2 通用 Workflow Runtime        A5 工具能力分类 + 健康探测
  A3 Agent 扩展（头像/分类/白名单/委派/升级）  A6 Board/Web 投影

轨道 B 内容作者化（量大，可批量并行） ── 决定覆盖面
  B1 Skill：方法 + 契约 + 溯源 + 评测集    B2 Workflow：阶段图 + Skill 引用 + 门
  B3 Agent：instructions + 绑定 + 头像 + 旅程评测

轨道 C 治理（贯穿） ── 决定能否上生产
  C1 来源策略 A0–A4 登记  C2 许可证/安全漂移  C3 指标遥测  C4 废弃生命周期
```

---

## 4. 目标架构

```
             ┌──────────── apps/web ────────────┐
             │ Agent 目录(头像/分类) · 运行面板 · 审批 · Board 参与者 │
             └───────────────┬──────────────────┘
                 contracts (Zod 单一事实源)
┌──────────────────── apps/api ─────────────────────────────┐
│ Agent 域(扩展)   Skill 域(扩展元数据)   Workflow 域(新)   Eval 域(新) │
│   │ skill pins     │ catalog 表          │ definition/version  │ suite/case/run │
│   │ workflow 白名单 │ manifest.work       │ instance/receipt   │ G0–G6 状态    │
│   └───────┬────────┴─────────┬──────────┴────────┬───────────┘
│   Context Pack / Org Brain   Tool/MCP(+能力分类)   Provenance/审计      │
└──────────┬─────────────────────────────┬───────────────────┘
   deep-agent-service(唯一 agent 内核)      skill-sandbox(确定性执行)
   PostgreSQL：业务行=事实，LangGraph checkpoint=编排状态；pg-boss=触发
```

### 4.1 Skill：扩展，不新建 WorkSkill 实体
- **载体统一为包模型**（`skills`/`skill_versions` + SKILL.md）：200 个 Skill 都是文件，走 starter-pack 发布，和现有 22 个平台 Skill 同一条路。
- **新增 `WorkSkillManifest`**（`packages/contracts/src/work-skill-manifest.ts`），写在 SKILL.md frontmatter 的 `metadata.work` 里，导入后进 `skill_versions.manifest`。不可变版本数据不需要迁移表结构。字段：
  - `stableId`（S/SK 编号）、`domain`、`riskClass`
  - `dependencies{required[], optional[]}`：写能力分类，不写具体供应商
  - `provenance[]`：repo、path、commit、license、strategy、copied、notice
  - `locales[]`/`jurisdictions[]`、`evalSuiteId`、`inputSchema`/`outputSchema`
- **新增可变的 `skill_catalog_entries` 表**：发布渠道（candidate/verified/deprecated）、后继 Skill、分类、搜索字段。`skills` 行保持现有 enabled/disabled 语义不动。
- **声明式模型 `skill_contracts` 不动**，也不给它加 Work 字段，避免三份事实。两套模型的收敛另立 issue，不塞进本项目。

### 4.2 Workflow：从两个先例抽出通用运行时
- 新建 `domain|application|infrastructure/workflow/`，按勘探结果的布局：
  - ports：DefinitionStore、InstanceStore、ReceiptStore、LeaseStore、EventLog、TriggerStore
  - use-cases：publish/start/resume/approve/cancel
  - `effect-gateway`：MCP 副作用/授权检查 → receipt → provenance
  - `stage-context`：Context Pack 泛化，从「run」扩成「run 或 workflow stage」
- **定义形态**：TypeScript 图工厂加版本化的 `WorkflowDefinition` 元数据（阶段、Skill 引用、门、副作用类别）。**不做通用 DSL 解释器**：60 个参考 Workflow 用代码写，确定性和可测性最好；DSL 等 Stage 3 有组织自建需求时再说。
- **统一**：
  - 一个 receipt 表，形状沿用引导式研究的 begin/finalize
  - 一套 lease
  - 一个 SSE 信封（seq + snapshot/delta + 断点续传）
  - 一个 checkpointer 工厂：独立 schema `langgraph_workflow`，按 `key:version` 分命名空间，共享连接池
- **在跑实例的版本规则**：实例固定在启动时的版本上；新版本只作用于新实例。
- **触发器**：pg-boss 泛化（能唤醒 workflow），新增 webhook 触发（签名校验 + 幂等键）。
- **迁移证明**：引导式研究迁到新运行时（Stage 1），数字访谈迁移放 Stage 2（它的 1847 行 effects 风险高）。

### 4.3 Agent = 数字人：加字段，不加实体
- 把字段加在 `agent_versions` 上，并加进 `SNAPSHOT_FROZEN_FIELDS` 和 clone 的继承列表：
  - `avatar{key|artifactId, alt, version}`：沿用 `interview-expert-avatar.ts` 的封闭 key 集做法
  - `roleCategory`（封闭枚举：enterprise-general / method-expert / industry-expert / professional-role / deep-professional）
  - `catalogSource`（official/org）
  - `workflowAllowlist[]`：固定到 Workflow 版本
  - `delegationPolicy{targets, maxDepth ≤ CALL_CHAIN_MAX_DEPTH, requireApproval}`
  - `escalationPolicy{triggers, target}`
  - `kpi{metric, target}`
- **执行点**：
  - Workflow 白名单 → `tool-execution-authority.ts`
  - 委派 → `call-chain.ts` 和 `authorize-subtask-parent.ts`
  - 升级 → 新的 `AgentInterruptKind: escalate`
- **官方 Agent 分发**：放宽 starter-pack 的 `toolPolicy` 契约和 DB CHECK（允许工具，但只能写能力分类，实际授权仍由组织管理员给，**不继承写权限**）；发 `agent-starter-packs/official-roles/<ver>.json`；按组织幂等导入。
- **转交（handoff）**：新的 run 事件「转交所有权」，目标必须在 `delegationPolicy` 内，并由人确认。

### 4.4 Eval 与 G0–G6
- 新建 `evals/work-stack/<entity>/<id>/`，每个实体一个套件：cases.jsonl + grader（规则优先，必要时用 LLM 评审并做校准）+ 无 Skill 的基线。
- `pnpm harness eval --entity S003` 在回环模型上跑确定性 case，真实模型走 `real-model-e2e` lane。
- G0–G6 做成脚本 `lint-work-stack-gates.mjs`：G0 身份 → G1 溯源/许可证 → G2 schema → G3 权限/注入 → G4 功能 → G5 对比基线 → G6 生产（遥测 + owner + 回滚）。门状态写回 `skill_catalog_entries`，只有 verified 的实体才能被官方 Agent 绑定。

### 4.5 工具分类与投影
- MCP 工具增加 `capabilityCategory`（crm.read、crm.write、mail.send…），Skill 依赖和 Agent 工具策略都写分类。
- 健康探测按 `service-uptime-poll-worker` 的模式做。
- Board：在 `board.ts` 加 agent 参与者和 workflow 运行两种对象，**只做投影**，写操作仍走 Board operation（要和 phase-19 协调）。

---

## 5. ADR 清单（Phase 0 产出，编号从 ADR-116 起）

| ADR | 决策 |
|---|---|
| 116 | Work Stack 需求权威 = #4502；分支需求并入后关闭 |
| 117 | Agent 即数字人：扩展 `agent_versions`，禁止 DigitalHuman 实体 |
| 118 | Work Skill 元数据放在包模型 manifest 里，另加可变的 catalog 表 |
| 119 | 通用 Workflow Runtime：代码定义 + 版本固定 + 统一 receipt/lease/SSE |
| 120 | Eval 与 G0–G6 发布门 |
| 121 | 工具能力分类；官方 Agent 只声明分类，不带授权 |

---

## 6. 路线图

仓库映射：**Stage 1 → phase-20，Stage 2 → phase-21，Stage 3 → phase-22**（都用 `pnpm harness new-phase --ui`）。phase-15 并入 phase-20。

### Phase 0 — 需求收敛与签核（不写产品代码）
1. 更新 #4502 需求：修 P1–P8，新增 `composition.yaml`（先写 Stage 1 的 50/20/10），出 ADR-116~121。
2. `new-phase` 建 phase-20；ui-prototyper 出目录、头像、运行面板、审批、Board 参与者的原型截图。
3. requirement-author 生成 phase-20 的 `feature_list.json`。
4. 切 5 个契约束，每个出 `design-signoff.md`：`work-skill-meta`、`workflow-runtime`、`agent-role`、`work-eval`、`work-projection`。
5. **人类签核 + 一致性复核通过 → 才开工。**

交付：1–2 个纯文档 PR。

### Stage 1（phase-20）— 底座 + 试点 + 补齐 50/20/10

**1a 平台底座（约 12 个 feature，可 3 路并行）**

| 泳道 | Feature |
|---|---|
| Skill | WS01 `WorkSkillManifest` 契约 + frontmatter 校验 · WS02 catalog 表 + 目录/搜索 API · WS03 依赖就绪计算（能力分类 × 已授权工具） |
| Workflow | WF01 domain + ports + 版本固定 · WF02 checkpointer 工厂 + receipt + lease · WF03 start/resume/approve/cancel + SSE 信封 · WF04 effect-gateway（权限重查 + receipt + provenance）· WF05 引导式研究迁到新运行时（证明通用性） |
| Agent | AG01 版本字段（头像/分类/白名单/委派/升级）· AG02 官方包契约放宽 + 按组织导入 · AG03 头像组件 + 目录页 |
| Eval | EV01 suite/case/grader + `harness eval` · EV02 G0–G4 门脚本 |

**1b 三条试点链路（端到端，真实用户路径）**
- 研究员：Research-to-Brief
- 产品经理：Feedback-to-PRD（取 #4502 的 Product 2 条 Workflow 之一）
- 销售：Lead-to-Qualified，含 CRM 写入审批

每条都要覆盖：happy path、拒绝、崩溃后恢复不重复副作用、权限中途撤销。只有这三条过了，才开始批量内容。

**1c 补齐内容**：余下的 Skill、Workflow 和 10 个 Agent，按领域分批，每批 5–10 个 Skill 对应一个 feature。

**出口**：#4502 的 Stage 1 五条出口条件，加上「无第二身份/第二运行时」的 lint（`lint-arch-deps` 增加规则）。

### Stage 2（phase-21）— 扩到 200 Skill / 40 Workflow / 30 Agent
平台：
- webhook/事件触发；定时触发 Workflow
- 工具分类注册表 + 健康探测 + 中/美 connector 包
- 委派/转交 UI
- 数字访谈迁到新运行时
- 中/美 locale 覆盖层
- 上游版本 bump / 许可证漂移检测
- G5 对比评测自动化

内容：余下的约 150 个 Skill，Workflow 和 Agent 分别再加 20 个（方法专家、行业专家）。

出口：≥100 个 Skill 为 verified；30 个 Agent 各有 ≥3 条旅程评测。

### Stage 3（phase-22）— 60/60 与生产治理
- 行业和受监管领域覆盖层（A2 净室重写）
- 组织私有 Agent/Skill 包
- 自治分级与 SLO
- verified 徽章和使用反馈
- 废弃/后继生命周期
- 三道门全自动后才开放社区投稿

出口：320 个实体都有 owner、溯源、评测、发布状态、遥测和维护路径。

---

## 7. 内容生产流水线（轨道 B 的做法）

每个 Skill 批次都走同一条流水线，可以多个 worker 并行：
1. **来源调研**：填 practice matrix，定 A0–A4，锁定具体 path/commit/license。A2 由另一个 agent 只输出抽象规格（净室）。
2. **作者化**：写 SKILL.md，含方法步骤、判定规则、输出 schema、失败模式和 1–2 个完整示例。
3. **评测**：至少 8 个 case（happy/缺输入/注入/权限/locale/工具失败/schema/边界），外加无 Skill 基线对比。
4. **门**：G0–G4 脚本全绿后，进 starter-pack，catalog 标 candidate；G5 通过后标 verified。
5. **review**：rev-feature 抽检；高风险领域（法律/金融/HR/医疗）要领域人审。

估算：每个 Skill 约 0.5–1 个 agent 日。200 个 Skill 在 4–6 路并行下大约需要 2–3 个月的持续产出。这是整个项目的关键路径。

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 平台未稳就批量做内容，返工成本乘以 200 | 1b 三条试点不过，不开 1c |
| 通用运行时过度设计 | 只抽两个先例里已经被证明的部分；DSL 推迟 |
| 模板化 Skill 进入目录，质量虚高 | G5 对比基线门：不比通用 Agent 好就不能标 verified |
| 许可证风险（n8n fair-code、未知许可证） | 默认只作参考；A3 只做行为重建；G1 机械检查 |
| 和 phase-18/19 抢路径、冲突 | Board 投影、Context Pack 泛化两处先和对应 phase owner 对齐接口 |
| 官方 Agent 带工具导致权限扩大 | 包里只写能力分类，授权由组织管理员给，默认只读 |
| 头像产出不在代码里 | 需要人类决定出图方式（D5） |

---

## 9. 需要你拍板的决策

| # | 决策 | 我的建议 |
|---|---|---|
| D1 | 需求权威用哪一份？ | **main #4502**；分支并入后关闭 |
| D2 | phase-15 空壳怎么处理？ | **并入 phase-20**，phase-15 标 superseded |
| D3 | 三个 Stage 映射成三个 phase（20/21/22），还是一个大 phase？ | **三个**，每个都能独立签核和出口 |
| D4 | Workflow 用代码定义还是做 DSL？ | **代码定义**，DSL 放 Stage 3 |
| D5 | 60 张头像谁出？ | 需要你定：设计师 / 生成加人工筛 / 先用插画 key 集占位 |
| D6 | 数字访谈迁到新运行时放在哪个阶段？ | **Stage 2**（Stage 1 先迁引导式研究） |
| D7 | 两套 Skill 模型的收敛是否纳入本项目？ | **不纳入**，另立 issue |

---

## 10. 批准后第一步

1. 建 issue：「Work Stack Phase 0：需求收敛 + ADR-116~121」。
2. 一个文档 PR：修订 #4502 需求（P1–P8）+ `composition.yaml`（Stage 1）+ 6 个 ADR。
3. 第二个 PR：`new-phase` 建 phase-20 + 原型截图 + `feature_list.json` + 5 个契约束签核文档，**然后停下，等你签核**。
