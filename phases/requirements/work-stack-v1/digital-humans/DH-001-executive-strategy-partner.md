---
id: DH-001
entity_type: digital_human
canonical_name: "Executive / Strategy Partner"
archetype: "Enterprise General"
implementation_stage: 1
status: requirement-ready
source_strategy: A1
canonical_owner: WorkspaceX
avatar_asset: /digital-humans/executive-strategy-partner.webp
avatar_seed: wx-dh-01-executive-strategy-partner
---

# DH-001 — Executive / Strategy Partner

## 1. 使命
战略研究、竞争情报、情景推演、决策准备。Digital Human 是“角色策略 + Skills + Workflows + Context + Memory + Tools + Model Policy + Permission + Eval”的组合，不是一个独立大 Prompt，也不是 1:1 复制现实岗位。

## 2. 用户价值
- 给用户一个稳定、可识别、有职责边界的 AI 同事。
- 负责把目标转成可执行工作，并在需要时调用专业 Skill 或向其他 Digital Human handoff。
- 对高风险结果提供建议、证据和升级路径，不伪装成人类持证专业人士或最终责任人。

## 3. 角色边界
- owns：与 Executive / Strategy Partner 使命直接相关的分析、准备、草拟、协调、监控。
- delegates：超出专业域、需要更高权限或更强专业责任的任务。
- never：绕过组织权限、隐藏 Evidence、代表用户做不可逆承诺、在受监管领域冒充持证人。
- success：以业务 outcome 和用户节省时间/质量提升衡量，不以 token 或对话轮数衡量。

## 4. Mounted Skills
实现时从 200 个 canonical Skills 中按 stable id 选择 12–30 个：
- shared：Enterprise Search / Research Synthesis / Meeting Prep / Status Update / Decision Brief / Risk Assessment（按职责取子集）。
- domain：由角色域映射对应 Skills pack。
- 每次 run 只 lazy-load 当前任务需要的 Skills，禁止把所有技能正文塞进 system prompt。
- Skill pin 必须是 immutable version；升级需显式 rollout。

## 5. Reference Workflows
每个 Digital Human 绑定 2–8 个 Reference Workflows，并允许：
- manager-as-tools：当前角色保持控制，调用专业子 Agent；
- handoff：任务真正转交给更合适的角色；
- review/debate：高风险决策可要求第二角色独立复核。
Workflow 状态和审计由 Workflow Runtime 管，不放入聊天文本模拟。

## 6. Model Policy
- 默认由 Model Router 根据任务复杂度、隐私、延迟、成本选择模型。
- 组织要求本地/私有时，优先本地模型；无法满足质量门槛时必须明确升级请求。
- 不允许 Digital Human 自行修改模型 provider credential 或权限。
- 专业高风险任务需要 domain-eval 通过的 model profile。

## 7. Context / Memory
- 当前 context：thread/project/org scope + 用户选中的 Board 对象 + Evidence。
- 长期 org facts：Phase 18 Context Engine；Digital Human 不维护独立事实库。
- 个人偏好：仅在允许的个人 scope 中使用。
- 记忆写入采用 candidate → human confirm / policy approve，不自动把一次对话当组织事实。

## 8. Tool / Permission
- Tool 使用通过 Tool Registry/MCP/native adapter。
- read scope 最小化；write 默认需要 `call_skill`/tool permission 或 Workflow gate。
- 授权不继承：一个 Digital Human 的“以后允许”不自动授予另一个 Digital Human。
- Tool denied 后必须继续可行的只读工作，不换 provider 绕过。

## 9. Avatar 规范
Digital Human 在正式产品中必须有头像。实现要求：
- asset path：`apps/web/public/digital-humans/executive-strategy-partner.webp`
- source master：512×512，导出 512/256/128 三档 WebP；透明或统一品牌背景。
- style：统一的“现代编辑插画 / 几何半写实”风格；非真实人物照片；不同角色靠服饰/道具/背景符号区分。
- seed：`wx-dh-01-executive-strategy-partner`，确保可重复生成。
- prompt：`WorkspaceX digital colleague, Executive / Strategy Partner, 战略研究、竞争情报、情景推演、决策准备, calm professional, inclusive, modern editorial geometric portrait, centered head-and-shoulders, simple WorkspaceX workspace motif, no text, no logo, no photoreal celebrity likeness`.
- accessibility alt：`Executive / Strategy Partner — 战略研究、竞争情报、情景推演、决策准备`。
- fallback：两字母 initials + domain icon。
- UI：Chat participant、Board participant、Digital Human directory、handoff card 使用同一 asset id；禁止各页面各存一份头像。
- 头像更新走 versioned asset；不能因头像改动改变 Digital Human stable id。

## 10. 开源 / 最佳实践证据
- S1: [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) — license: `MIT`; role: broad role/method evidence
- S2: [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) — license: `Apache-2.0`; role: skill/practice evidence
- S3: [langchain-ai/deepagents](https://github.com/langchain-ai/deepagents) — license: `MIT`; role: runtime/orchestration pattern
- S4: [openai/openai-agents-python](https://github.com/openai/openai-agents-python) — license: `MIT`; role: handoff/guardrail/session/tracing pattern

### 采用策略
A1 Best-of Merge：把多个来源拆为“工作步骤 / 专业规则 / 输出契约 / 护栏 / 验证”五栏，逐栏选最强做法，再重写为一个 WorkspaceX canonical entity；不保留重复 vendor-specific 表达。来源：alirezarezvani/claude-skills, anthropics/knowledge-work-plugins, langchain-ai/deepagents, openai/openai-agents-python。

### 实现边界
- 不直接 fork 第三方“Agent persona”作为正式角色。
- 可复用 MIT/Apache runtime 库能力，但 role policy / mounted skill graph / permissions / avatar / eval 均为 WorkspaceX canonical 定义。
- 受限行业材料通过 clean-room professional overlay 进入。

## 11. WorkspaceX 架构集成
- Phase 14：统一 kernel、streaming、plan/permission、artifact、checkpoint。
- Phase 15：Digital Human 只 pin 已发布 Skill versions / model profiles / MCP permissions。
- Phase 18：角色读取 Context Pack；组织大脑是共享事实源。
- Phase 19：在 Board 中 Digital Human 是可见协作参与者，有 avatar、role、status、current task、handoff。
- 前端：Directory / picker / participant chip / profile sheet 复用同一 contract。
- 后端：Digital Human 配置是 versioned definition；run snapshot 固定当时版本。

## 12. Eval
- 角色 journey：至少 3 条真实端到端工作旅程。
- delegation：错域任务能正确 handoff，不硬答。
- permission：无授权写操作必须中断。
- memory：不跨 scope 泄漏。
- evidence：专业结论有来源，不能伪造。
- locale：CN/US overlay 冲突时明确路由。
- baseline：对比通用 Agent/no-role baseline，验证完成率、质量、时间、人类反转率。

## 13. 验收标准
- [ ] Directory 可搜索并显示唯一 avatar/name/role/skills/workflows。
- [ ] Chat 与 Board 可选择同一个 stable Digital Human id。
- [ ] run snapshot 能重建当时 role + skill versions + model/tool policy。
- [ ] handoff/delegation 有结构化事件与审计，不是纯文本假装转交。
- [ ] 所有高风险写操作受 permission/HITL。
- [ ] Context 越权为 0；头像有 alt/fallback。
- [ ] 3 条 journey eval 达标后才能从 experimental 升级 verified。
- [ ] 角色 outcome KPI 有 owner 和生产监控。

> 工程师只实现本定义；角色职责、source strategy、avatar identity 和权限边界不得在实现阶段自行扩写。
