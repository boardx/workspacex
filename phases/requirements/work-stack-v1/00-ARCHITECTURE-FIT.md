# WorkspaceX Work Stack v1 — 当前架构适配

## 已存在、必须复用
1. **Phase 14 Agent Kernel**：apps/api 已退化为薄网关；deep-agent-service 是唯一执行内核；已有真流式、checkpoint、Plan Mode、Tool Permission、Artifact versioning、interjection。
2. **Phase 15 AI Capability Studio**：GitHub/ZIP/blank Skill → draft → revision → trial → immutable publish → Agent pin；Model/MCP 依赖可固定快照。
3. **Phase 18 Org Brain / Context Engine**：PG canonical + AGE projection + pgvector；Context Pack 是事实召回入口；模型不能直写 ontology。
4. **Phase 19 Board Visual Workspace**：Fabric + Yjs 单一事实源；AI/human/import/API 统一走 Board operation；Board 是 Human-AI 可视协作面。
5. **deep-agent-service**：deepagents + LangGraph + PG checkpointer + LangMem + OTel。
6. **skill-sandbox**：隔离代码/文件生成/Office 重算能力。
7. **contracts**：`skills.ts`、`deep-agent-hitl.ts`、`skill-source-connections.ts` 等作为 API 单一事实源。

## 这 320 个 requirement 不允许引入
- 第二套 agent loop；
- 第二套组织 memory / vector store；
- 第三方 workflow runtime 作为隐藏事实源；
- Digital Human 自己持有 credential；
- Skill 直接越过 Tool Registry；
- Board AI 使用独立 mutation 模型；
- repo 级许可证直接推导 artifact 可复用。

## 需要新增的 canonical domain
- WorkSkillDefinition / WorkSkillVersion：建立在现有 Skill version 上扩 metadata，不复制已有 version chain。
- WorkflowDefinition / WorkflowVersion / WorkflowExecution：确定性 + agentic 的 durable orchestration。
- DigitalHumanDefinition / DigitalHumanVersion：role policy、avatar、mounted skills、workflows、model/tool policy。
- WorkStackRegistry：统一目录/搜索/治理视图；底层仍分别引用现有 Skill/Model/MCP/Context 数据。
- EvalBinding：entity version → eval suite → evidence → verified status。

## 建议服务边界
- apps/api：auth、RLS、registry API、definition/version/pin、execution ledger。
- apps/deep-agent-service：agentic steps / skill calls / delegation / plan/HITL。
- workflow runtime（新增或从 API domain 独立）：durable state、schedule、idempotency、retry、compensation。
- apps/skill-sandbox：代码和 Office deterministic execution。
- apps/web：Capability Studio + Digital Human Directory + Visual Work Graph + Board participant。
