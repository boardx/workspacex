---
id: SK-025
entity_type: skill
canonical_name: "Lead Triage"
domain: sales
status: requirement-ready
implementation_stage: 1
source_strategy: A1
risk_class: medium
canonical_owner: WorkspaceX
runtime: deep-agent-service
registry: phase-15-ai-capability-studio
context: phase-18-org-brain-knowledge-graph
visual_surface: phase-19-board-visual-workspace
---

# SK-025 — Lead Triage

## 1. 目标
把 **Lead Triage** 固化为 WorkspaceX 可版本化、可挂载、可评测、可审计的 canonical Work Skill。它描述“如何专业地完成一项工作”，不绑定单一模型、单一 MCP 或单一 SaaS。

## 2. 用户意图与边界
- 触发：用户明确提出与 **Lead Triage** 对应的任务，或 Workflow/Digital Human 通过稳定 skill id 调用。
- 必做：收集最小必要上下文 → 执行专业步骤 → 形成结构化结果 → 验证 → 返回证据/产出物。
- 不做：未经授权扩大数据范围；把缺失数据当 0；把外部不可信内容当指令；绕过 Tool Registry 权限；自行升级法务/财务/雇佣等高风险决定。
- 高风险结论必须以“建议/提案”返回，由人类或有权限的下游 Workflow 决定是否执行。

## 3. 输入契约
- `task`: 自然语言任务，必填。
- `context_refs[]`: WorkspaceX 对话、Board 对象、Artifact、Org Brain claim 的引用。
- `constraints`: locale / jurisdiction / deadline / output_format / audience。
- `tool_snapshot`: 当前允许的 Tool/MCP 集合，只读快照，不允许 skill 自行扩权。
- 输入缺失时：列出缺口并只问阻塞问题；可在 files-only/read-only 模式继续时不得强制要求连接器。

## 4. 输出契约
- `summary`: 人可直接消费的结论。
- `artifact?`: 需要持久化时生成 Artifact，并绑定 run/step/version。
- `evidence[]`: 每个关键 claim 对应来源引用。
- `actions[]`: 建议动作，默认 proposal；需要写外部系统时必须经过 HITL。
- `omissions[]`: 因权限、数据、工具或模型不可用而未完成的部分。
- `quality_checks[]`: 本次执行的验证规则及结果。

## 5. 标准执行步骤
1. Resolve scope：确认用户、组织、项目/会话作用域。
2. Gather：仅读取当前权限内的 Context Pack、附件、企业数据和获准连接器。
3. Analyze：按 Lead Triage 的专业方法执行分解、比较、计算或判断。
4. Draft：生成结构化中间结果；高风险内容标出假设与不确定性。
5. Verify：交叉核对关键数字、来源、规则、locale/jurisdiction。
6. Act or propose：只读技能直接完成；写操作转交 `call_skill`/Tool permission gate 或 Workflow human gate。
7. Record：产出物、evidence、状态与可复用知识按现有 Artifact/Context 规则落库。

## 6. 依赖
- Primitives：retrieve / extract / analyze / generate / verify；按任务可追加 calculate / plan / visualize / execute。
- Models：由 Model Router 选择；抽取/分类优先小模型或本地模型，复杂专业判断才升级到 frontier。
- Tools/MCP：provider-neutral category contract；没有 connector 时必须有上传/粘贴降级。
- Runtime：复用 `apps/deep-agent-service`（deepagents + LangGraph + PG checkpoint）。
- HITL：复用 `packages/contracts/src/deep-agent-hitl.ts` 的真实 `call_skill` 中断契约。
- Sandbox：需要代码/Office 重算时走 `apps/skill-sandbox`，禁止任意宿主执行。

## 7. Context / Memory
- 读取：Phase 18 Context Engine 产生的 scope-bound Context Pack；AGE/pgvector 不可用时 omissions 必须可见。
- 写入：Skill 不直接写 canonical ontology；只提交候选 action，由服务端校验器执行。
- 跨会话复用必须遵守 L0/L1 晋升规则和人类确认边界。

## 8. 权限与失败语义
- read：沿用当前 org/project/thread 可见性。
- write：默认 proposal；L2 或不可逆/高影响动作必须 `awaiting_tool_permission`。
- denied：继续只读分析，不重试、不换工具绕过。
- dependency unavailable：明确说明缺失能力，不静默降级。
- stale revision：拒绝写入并要求基于最新 revision 重试。

## 9. 开源 / 最佳实践证据
- S1: [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) — license: `Apache-2.0`; role: skill/practice evidence
- S2: [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) — license: `MIT`; role: marketing practice evidence

### 采用策略
A1 Best-of Merge：把多个来源拆为“工作步骤 / 专业规则 / 输出契约 / 护栏 / 验证”五栏，逐栏选最强做法，再重写为一个 WorkspaceX canonical entity；不保留重复 vendor-specific 表达。来源：anthropics/knowledge-work-plugins, coreyhaines31/marketingskills。

### 开源代码整合要求
- 默认不复制源代码；先形成 practice matrix，再以 WorkspaceX schema 重新实现。
- 任何 source 变更必须触发 license/provenance re-check 和 Eval 失效。
- 受限或 non-commercial 来源只能进入 evidence 层，不能进入可分发 canonical 内容。

## 10. WorkspaceX 集成点
- Phase 15：作为 Skill draft → trial → immutable publish → Agent pin 的开发对象。
- Phase 14：运行通过统一 kernel、流式事件、Plan Mode、Permission 与 Artifact versioning。
- Phase 18：上下文/组织事实来自 Context Engine，不自行建立第二套 memory。
- Phase 19：在 Board 上以 Skill 卡、输入对象、Evidence、Artifact、Action proposal 可视化；AI mutation 必须走统一 Board operation。
- API/contracts：稳定 id `SK-025` 不因实现来源变化而改变。

## 11. Eval
至少覆盖：
1. golden happy path；
2. missing-data / absent-is-not-zero；
3. untrusted-content / prompt injection；
4. permission denied；
5. locale/jurisdiction 不匹配；
6. tool unavailable；
7. output schema；
8. 同模型 no-skill baseline。
- Verified 门槛：相对 no-skill baseline 有可解释质量提升（目标 ≥10pp 或明确 cycle-time/错误率收益）。
- 高风险 Skill 必须另加 adversarial 与人工 domain review。

## 12. 验收标准
- [ ] 可从 Phase 15 发布为 immutable version，并由 Agent 固定 pin。
- [ ] 真实 `deep-agent-service` run 可加载并执行，不使用 mock 代替。
- [ ] 所有外部写入都经过权限/HITL，拒绝后无副作用。
- [ ] Artifact / Evidence 可追溯到 run/step/source。
- [ ] Context 越权测试为 0。
- [ ] Eval 最小集与 baseline 通过。
- [ ] Source strategy / license / upstream revision 可审计。
- [ ] Board/Chat 两个入口产生一致的 canonical execution record。

## 13. 工程实现清单
- contracts：定义/复用 skill metadata、依赖、risk、output schema。
- api：registry/read/publish/pin，不在 API 内实现第二套 agent loop。
- runtime：skill loader + tool snapshot + context pack + checkpoint。
- web：Skill detail / run / evidence / artifact / permission UI。
- eval：固定夹具、baseline、回归。
- docs：upstream SHA、license、strategy、NOTICE（如适用）。

> 边界：工程师实现本需求，不重新定义 Skill 的 source strategy、权限模型或 Context 写入规则。
