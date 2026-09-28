# Current architecture review

## Baseline findings
1. **Contract SSOT**: `packages/contracts/src/*` is already the transport/schema single source.
2. **Skill domain exists**: `apps/api/src/domain/skill/*`, `application/{skill,skill-import}/*`, infrastructure repositories, immutable versions, source binding, import/recovery, publish/security gates.
3. **Agent composition exists**: Agent domain plus `agent-skill-pins`; there is no architectural reason to create a separate DigitalHuman execution runtime.
4. **Agent runtime exists**: DeepAgents/LangGraph in `apps/deep-agent-service`; stable chat threads map to durable LangGraph threads.
5. **Durable workflow precedent exists**: Digital interview uses TypeScript LangGraph + PostgreSQL/PostgresSaver + canonical business rows + SSE projections + durable human interrupts.
6. **Context Engine / Org Brain exists**: product context is assembled through bounded Context Packs; product Org Brain and harness meta-ontology are explicitly separate.
7. **HITL exists**: reuse existing allow/ask/block semantics and permission re-checks; approvals must not be UI-only.
8. **Sandbox exists**: `apps/skill-sandbox` is the execution boundary for deterministic scripts/Office/data work.
9. **Provenance/audit exists**: Skill activity and runtime provenance already distinguish metadata/read/execution facts.
10. **Visual Workspace exists as an active phase**: Phase 19 is the target UI surface for visible work objects.

## Target placement
### Skill
Professional method + contract + dependencies + policy + provenance + eval. Published versions remain immutable.

### Workflow
Trigger + durable state + sequencing + branching + HITL + idempotent effects + recovery + audit. A workflow references Skills; it does not duplicate their professional logic.

### DigitalHuman
Existing Agent identity/version + role profile + avatar + skill pins + allowed workflows + context/memory/model/tool/permission policies + delegation/escalation + eval/outcome metrics.

## Required platform additions
- Backward-compatible Work Skill metadata schema.
- Generic Workflow definition/runtime API derived from digital-interview implementation.
- DigitalHumanProfile linked to existing Agent version.
- Cross-entity registry/search/projection APIs.
- Eval bindings and release gates G0–G6.
- Board projections for DigitalHuman, Workflow, approval, evidence and outcome.
