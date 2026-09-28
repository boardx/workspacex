# D025 — Life Sciences / Pharma Expert

> **Type**: DigitalHuman · **Phase**: 2 · **Archetype**: Industry Expert · **Canonical owner**: WorkspaceX  
> **Strategy**: **A1 — Best-of Merge** · **Avatar required**: yes

## 1. Mission
文献、临床、监管、医学事务、研发知识.

This DigitalHuman is a **role specialization of the existing WorkspaceX Agent runtime**. It combines role policy, avatar, Skill pins, Workflow assignments, Context/Memory/Model/Tool policies, delegation/escalation and outcome evals. It MUST NOT create a second Agent execution stack.

## 2. Role boundary
### Responsible for
- Own role-level intent classification, work routing, prioritization and human-facing progress.
- Select only published/allowed Skill versions and approved Workflows.
- Present evidence, assumptions, risks, pending approvals and final artifacts.
- Delegate/handoff when another DigitalHuman becomes the accountable specialist.

### Not responsible for
- Reimplementing professional logic that belongs in a Skill.
- Reimplementing durable orchestration that belongs in a Workflow.
- Direct database writes outside application ports.
- Inheriting human/admin write permissions by default.
- Making irreversible/high-impact decisions where human accountability is required.

## 3. Composition contract
- Agent identity/version: existing Agent domain SSOT.
- Skill selection: existing Agent Skill Pins; pins are immutable/version-aware at runtime.
- Workflow allowlist: versioned workflow IDs; no inline hidden workflow copies.
- Context: bounded ContextPack + role/org/project scope.
- Memory: role-scoped working memory; only approved knowledge is promoted to Org Brain.
- Model policy: task/privacy/cost/latency routed; local/on-prem when policy requires.
- Tool policy: capability/category allowlist + least privilege.
- Delegation: manager-as-tools for bounded subtasks; handoff for ownership transfer.
- Escalation: human or specialist on high risk, low confidence, conflicting evidence, missing jurisdiction or failed verification.

## 4. Avatar contract
- Required asset: `apps/web/public/digital-humans/life-sciences-pharma-expert.webp`.
- Master 512×512 WebP, sRGB, target <=200 KB; optional 128×128 derivative.
- Metadata: `avatarAssetId`, `avatarAlt`, `avatarVersion`, crop/focal metadata.
- Visual system: professional editorial portrait/icon hybrid, consistent composition, subtle archetype/category motif.
- No celebrity/real-person likeness, protected logo, stereotype or false credential cue.
- UI fallback: canonical role initials; avatar load failure MUST NOT block Agent execution.
- Required surfaces: catalog, Agent header, Board participant object, workflow owner chip, handoff/approval UI, audit timeline.

## 5. Open-source / best-practice evidence
- **anthropics/knowledge-work-plugins** — role/domain practice evidence; license/terms: `Apache-2.0`; https://github.com/anthropics/knowledge-work-plugins
- **langchain-ai/deepagents** — runtime/composition reference; MIT; https://github.com/langchain-ai/deepagents

### Source strategy
Distill complementary role practices into one WorkspaceX-owned profile. Keep source provenance and do not concatenate upstream prompt/persona text.

## 6. WorkspaceX code placement
- Contract: add backward-compatible `DigitalHumanProfile` schema under `packages/contracts/src/`, keyed to existing Agent definition/version.
- API domain/application: extend existing Agent domain/use cases; do **not** add parallel DigitalHuman runtime tables that duplicate Agent identity/version/publish lifecycle.
- Runtime: execute through current Agent Runtime / DeepAgent / LangGraph path.
- Skill composition: existing `agent-skill-pins`.
- Context: Context Engine / Org Brain; no direct arbitrary data reads.
- Board/Web: project avatar, role, current workflow/task, status, pending approval, latest evidence/artifact, handoff target.
- Provenance/audit: every external action records actor, org, agent version, skill version, workflow run, tool call and approval.

## 7. Human control
- Human remains accountable for regulated/high-impact decisions.
- Ask/approval is durable state; permission is rechecked at resume/execution time.
- Human can inspect role definition/Skills/Tools, pause, cancel, approve, deny or change handoff target.
- Revoked permission cannot be bypassed by a previous approval.

## 8. Required evals
1. Route at least 10 representative intents.
2. Complete one multi-Skill end-to-end role journey.
3. Delegation/handoff correctness.
4. Tool permission downgrade/revocation mid-run.
5. Org/project memory isolation.
6. Low-confidence/high-risk escalation.
7. Avatar/UI accessibility and fallback.
8. Business KPI defined and measured before Verified status.

## 9. Acceptance criteria
- [ ] Avatar asset/metadata exist and render in catalog and Board.
- [ ] Backed by existing Agent identity/version/publish lifecycle.
- [ ] Skill pins and Workflow assignments are versioned and inspectable.
- [ ] No hidden inherited external-write privilege.
- [ ] Context/Memory isolation tests pass.
- [ ] Human can pause/cancel/approve/deny and audit external actions.
- [ ] At least one realistic journey meets its role KPI.
- [ ] G0–G6 release gates are satisfied before production.

## 10. Definition of done
The DigitalHuman is visible in Workspace with its avatar, accepts role-appropriate work, composes approved Skills/Workflows, uses replaceable tools/models under policy, exposes evidence and approvals, and completes or escalates without bypassing existing Agent/Context/Permission architecture.
