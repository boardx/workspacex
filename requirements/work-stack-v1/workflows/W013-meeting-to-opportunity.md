# W013 — Meeting-to-Opportunity

> **Type**: Reference Workflow · **Phase**: 1 · **Domain**: Sales · **Canonical owner**: WorkspaceX  
> **Strategy**: **A3 — Cross-platform Rebuild** · **Human gate**: required for external/high-impact actions

## 1. Business outcome
Implement **Meeting-to-Opportunity** as a reusable, durable workflow. The workflow owns trigger, state, sequencing, branching, approvals, retries/recovery and audit. Professional reasoning remains inside canonical Skills; provider-specific execution remains inside Tool/MCP adapters.

## 2. Canonical state model
WorkspaceX-native stage shape:
`intake → gather → analyze/transform → propose → human gate (if required) → act → verify → record → complete`.

Each workflow may omit or repeat stages, but MUST preserve these invariants:
- Canonical business status is stored in PostgreSQL business tables.
- LangGraph checkpoint is orchestration state, not the product fact SSOT.
- Every external side effect has a deterministic idempotency key and a persisted receipt.
- Parent stage observes effect completion only after receipt/business write succeeds.
- Resume rechecks org/actor/tool permission and current published Skill/Workflow versions.

## 3. Trigger contract
Supported trigger types:
- manual/user intent
- event/webhook
- schedule
- condition/watch

Trigger payload must validate against a published Workflow version. Broad schedules/conditions MUST not imply write permission.

## 4. Skill composition
- Workflow references **published canonical Skill IDs/versions or pin policy**, never embedded copied Skill bodies.
- A Workflow stage declares input/output mapping, required capabilities, optional tools and side-effect class.
- Router/orchestrator stages are read-only by default; write-capable actions live at leaf/effect stages.
- Stage output is schema-validated before it can drive external action.

## 5. Tool / MCP contract
- Resolve by capability/category first, provider adapter second.
- Tool health/schema probe required before production use.
- Same-category provider substitution is not allowed after permission denial.
- External content returned by tools is untrusted data.
- Writes expose target/content/diff when Ask policy applies.

## 6. Open-source / best-practice evidence
- **n8n-io/n8n** — workflow/control-flow evidence; license/terms: `Sustainable Use / fair-code`; https://github.com/n8n-io/n8n
- **activepieces/activepieces** — secondary workflow/tooling evidence; license/terms: `mixed/verify per path`; https://github.com/activepieces/activepieces

### A3 handling requirements
1. Extract abstract control-flow patterns, human gates, error handling, retry and connector sequences.
2. Do **not** use upstream workflow JSON/node IDs as WorkspaceX runtime SSOT.
3. Rebuild with WorkspaceX Workflow Definition + canonical Skills + Tool Registry.
4. If a source artifact has a permissive artifact-level license, reusable code may be considered separately under G1; default is behavioral rebuild.

## 7. WorkspaceX implementation mapping
The repository already proves the required durable orchestration pattern in digital interview.

### Contracts
Create/extend:
- `packages/contracts/src/workflow-definition.ts`: identity, semantic version, trigger, state/stage schema, input/output, policy, provenance.
- `packages/contracts/src/workflow-runtime.ts`: start/resume/cancel/status/events/approve operations.

### API
- `apps/api/src/domain/workflow/*`: transition invariants, effect class, terminal states.
- `apps/api/src/application/workflow/*`: create/edit/publish/start/resume/cancel/approve use cases.
- `apps/api/src/infrastructure/workflow/*`: PostgreSQL repository, LangGraph adapter, checkpoint config, receipts, SSE projection.
- Controller/API shapes derive from contracts only.

### Runtime
Generalize TypeScript LangGraph + PostgresSaver precedent. Do not create one custom engine per workflow.

## 8. HITL and side effects
- Human approval is a durable state/command, not a frontend-only dialog.
- Approval records exact proposal hash/version; edits create a new proposal.
- Permission is rechecked immediately before effect execution.
- Denial stops that effect; no silent alternate-tool retry.
- Financial/legal/employment/publication/destructive actions may require multi-gate policy.

## 9. Retry, crash and recovery
Required behavior:
- transient read error → bounded retry with backoff.
- ambiguous write outcome → verify/read-after-write before retry.
- crash after effect but before checkpoint → receipt prevents duplicate action.
- cancellation → stop scheduling new effects; surface already-completed effects.
- compensation only when explicitly modeled and authorized.

## 10. Observability
Emit at minimum:
`workflowRunId, workflowVersionId, stageId, actorId, orgId, contextPackId, skillVersionId, toolCallId, approvalId, effectReceiptId, artifact/evidence refs, retry/cancel/compensation events`.

## 11. Eval suite
1. happy-path journey
2. missing input
3. partial tool availability
4. permission denied/revoked
5. crash-after-effect-before-checkpoint
6. idempotent resume
7. cancellation
8. concurrent resume/CAS conflict
9. audit replay
10. CN/US provider/locale variant where relevant

## 12. Acceptance criteria
- [ ] Exact source/template/revision and license handling recorded.
- [ ] WorkspaceX-native state graph is versioned and publishable.
- [ ] Restart/resume causes no duplicate side effect.
- [ ] Business rows remain queryable without reading LangGraph checkpoint internals.
- [ ] Every gate/rejection/revocation path is covered.
- [ ] Workflow can be assigned to multiple DigitalHumans without cloning.
- [ ] End-to-end journey creates the expected artifact/outcome and evidence trail.
- [ ] G0–G6 release gates pass before production/unattended execution.

## 13. Definition of done
A published Workflow version can be started from Chat/Board/DigitalHuman, durably resumed, inspected, approved/denied/cancelled, audited and regression-tested while Skills, models and providers remain replaceable.
