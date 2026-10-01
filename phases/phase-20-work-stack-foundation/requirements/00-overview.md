# 需求索引 — work-stack-foundation（Phase 20）

> 本阶段实现 Work Stack 第一阶段：4 个角色 Agent（D002 研究员 / D003 产品经理 /
> D005 销售 / D011 设计思维）、它们的 19 个 Workflow 与 58 个 Skill。
>
> **权威链**：本文件夹的 *.md 是「输入/上下文」，不是权威；权威永远是
> `../feature_list.json`（由 requirement-author 从这些文档生成）。原始实体需求（已评审
> PASS）在 `requirements/work-stack-v2/{skills,workflows,digital-humans}/`，清单见
> 该目录 `WORK-STACK-320-LIST.md` 的「第一阶段」节（81 个实体，全部 ✅ 通过）。
>
> **架构权威**：`docs/proposals/PROP-WORK-STACK-001.md`（先读「修订 R1」）与
> `docs/adr/ADR-116..121`；10 轮实现计划 `docs/proposals/WORK-STACK-PHASE1-IMPL.plan.md`。
> 关键规则：Agent 即 DigitalHuman（扩展 `agent_versions`，不建 DigitalHuman 实体）；
> Skill 元数据走包模型上的 `WorkSkillManifest` + 可变 `skill_catalog_entries`；从
> digital-interview / guided-research 的 LangGraph 先例泛化出通用 Workflow Runtime
> （代码定义图、版本固定、统一 receipt/lease/SSE、effect-gateway 执行前重查权限）；
> Workflow 固定其 Skill 版本、所属 Agent 无需挂载（ADR-118 #9）；eval 套件 + G0–G5 门；
> 工具能力分类；不含实时语音（范围外，ADR-121 独立轨道）。
>
> **签核**：本阶段经 2026-09-28 人类授权，签核前可先开发；任何束级
> `contracts/<bundle>/design-signoff.md` 的 status 保持 pending，由人类补签，agent 不改。

## R1 阅读顺序与各文件职责

按下列顺序阅读；每份文件的章节 ID（R1…Rn）在文件内独立编号，是 `feature_list.json`
的 `spec_ref` 追溯锚点。括号内为该文件的估点与对应实现轮次（wave）。

1. **`01-skill-catalog.md`** — Work Skill 元数据与目录（能力域 work-skill-meta，估点
   **29**，wave 2）。`WorkSkillManifest` 契约 + frontmatter 校验、`skill_catalog_entries`
   迁移与仓储、目录/搜索/详情 API、依赖就绪性计算、目录页 UI。feature 前缀 **WS**。
2. **`02-workflow-runtime.md`** — 通用 Workflow Runtime（workflow-runtime，估点 **34**，
   wave 3–4）。domain/ports 与版本固定、checkpointer 工厂 + 统一 receipt/lease、
   start/resume/cancel API + SSE、effect-gateway 权限重查、人工门、pg-boss + webhook 触发、
   引导式研究迁移、运行面板 UI。feature 前缀 **WF**。
3. **`03-agent-role.md`** — Agent 角色扩展与官方角色包（agent-role，估点 **34**，wave 5、
   10）。`agent_versions` 冻结字段 + 快照、starter-pack toolPolicy 放宽为能力分类、官方
   4 角色包导入、头像组件 + Agent 目录 UI、Workflow 白名单执行、`escalate` 中断、handoff。
   feature 前缀 **AG**。
4. **`04-eval-gates.md`** — Work Stack 评测与发布门（work-eval，估点 **30**，wave 6、10）。
   套件格式契约 + S003 首个套件、`pnpm harness eval` 回环运行器、`lint-work-stack-gates`
   G0–G4 门 + 反证测试、门状态回写 + 目录展示、G5 基线批量与 verified 联动。前缀 **EV**。
5. **`05-content-lines.md`** — 三条内容线落地（work-content，估点 **62**，wave 7–10）。
   研究线 / 产品线 / 销售线的 Skill 包 + Workflow 定义 + 端到端旅程、Board 只读投影、
   81 实体全量对账与回归。feature 前缀 **CT**。

## R2 依赖层次（哪些先开工）

- **wave 2（WS01–WS05）** 是全阶段地基：Skill 元数据与目录先落地，WS01 无前置、最先开工。
- **wave 3（WF01–WF03）** 与 wave 2 后半可并行；Runtime 核心 WF01 无前置。
- **wave 4（WF04–WF08）** 在 Runtime 核心之上：effect-gateway / 人工门 / 触发器 / 引导式研究迁移 / 面板。
- **wave 5（AG01–AG06）** Agent 扩展依赖 wave 2 目录与 wave 3 注册表；AG01/AG02 可并行先行。
- **wave 6（EV01–EV04）** 评测与门依赖 wave 2 目录；EV01 无前置先行。
- **wave 7–9（CT01–CT09）** 三条内容线，各线内 Skill 包 → Workflow 定义 → e2e，wave 6 后可并行。
- **wave 10（AG07 / EV05 / CT10 / CT11）** 收口：handoff、G5 批量、Board 投影、全量对账。

## R3 依据等级与签核前提

第一阶段 81 个实体的实体文档均为**评审 PASS**（`requirements/work-stack-v2/reviews/`），
是本阶段所有 feature 的一等依据，无 `[Backlog]`/`[设计]`/`原型确认缺失` 级别的欠证据项。
UI 类 feature（WS05 / WF08 / AG04 / EV04 / CT10，`has_ui=true`）的界面权威在各契约束的
`contracts/<bundle>/ui.md` + `design-signoff.md`；开工前须由人类签核（ADR-023），本阶段
按授权先开发、签核状态保持 pending。有若干口径待收敛项已在实现 issue 登记（如 ADR-119 与
PROP §4.4 的 eval 路径两级/一级写法，以 ADR-119 为准），见各文件「现状核实」节。
