---
id: W001
entity_type: workflow
canonical_name: "Research-to-Brief"
domain: shared
status: proposed-unwired
source_strategy: Clean-room Rewrite
baseline_main_sha: d988b843c798862c4f76180a2ef390ad13ef323d
phase: 1
phase_consumers: [D001, D002]
---

# W001 — Research-to-Brief

## 1. Purpose and boundary

W001 turns one caller-authorized research question and one project context into a reviewable brief whose material claims point back to retrieved evidence. It is shared by D001 Executive / Strategy Partner and D002 Research & Knowledge Analyst. It is a bounded, read-first workflow: it does not browse the public web, connect to arbitrary providers, make a business decision, publish, send, or persist a new organizational Claim on the caller's behalf.

W001 uses five exact conditional Skills: **S003 Enterprise Search**, **S063 Research Synthesis**, **S171 Evidence Review**, **S020 Executive Briefing**, and **S010 Risk Assessment**. These are eligible only for a run that selects W001 under the proposed closure contract. They are not thereby installed for the DigitalHuman's unrelated runs. Workflow selection does not currently auto-mount them in main.

The supported retrieval boundary is the existing `POST /context-packs` contract, scoped for this workflow to one explicit project at a time. It is not a new search endpoint and does not promise that every retrieval channel or connector is deployed. A missing or failed retrieval dependency blocks generation; W001 may not replace it with unaudited free-form browsing or pretend that no results means retrieval succeeded.

## 2. Composition and version binding

| Workflow edge | Exact conditional Skill | Stage responsibility |
|---|---|---|
| W001 → S003 | Enterprise Search | Build the authorized Context Pack from the research query. |
| W001 → S063 | Research Synthesis | Organize findings, disagreement, uncertainty, and open questions from the pack. |
| W001 → S171 | Evidence Review | Classify support quality and source limitations; do not elevate an unreviewed Claim to fact. |
| W001 → S020 | Executive Briefing | Shape the verified analysis into an audience-oriented brief. |
| W001 → S010 | Risk Assessment | Identify material risks, exposure, mitigation questions, and residual unknowns. |

At publication, W001 must bind one immutable version ID for each of the five Skills and record the published Workflow version. At run creation the proposed resolver must freeze the selected DigitalHuman version, W001 version, graph revision/digest, exact Skill version IDs, and each pin's `workflow-inherited` origin in the run snapshot. If the selected role has a direct pin for a same Skill ID, identical version IDs are deduplicated while both origins are recorded; conflicting version IDs fail before model or tool execution. Missing, disabled, inaccessible, ambiguous, or non-immutable pins fail closed. No `latest` lookup or partial Skill set is allowed.

**Implementation boundary:** the closure, resolver, origin map, graph-digest snapshot, and W001 workflow runtime are proposed requirements, not implemented behavior on main at `d988b843c798862c4f76180a2ef390ad13ef323d`. Main's Skill runtime consumes explicit version pins; its existence does not prove Workflow-to-DigitalHuman inheritance.

## 3. Trigger and request schema

Only a caller-authorized manual request is in this Phase 1 slice. Event, schedule, and condition triggers need separate source contracts and authorization proofs; they are not enabled by this document. The request body never supplies trusted identity or a published version. The authenticated server binds actor/principal and organization, resolves the published W001 version, validates the caller-selected project against current authorization, and derives the authorized run context. The project must be explicit and singular in Phase 1; an organization-wide or cross-project request is rejected for scope selection rather than interpreted as permission to search broadly.

The following is the proposed W001 input envelope, not a current API DTO:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["trigger", "workflowId", "projectId", "idempotencyKey", "researchQuestion", "audience", "evidencePolicy", "freshnessRequirement", "manualItemSegmentIds"],
  "properties": {
    "trigger": {"const": "manual"},
    "workflowId": {"const": "W001"},
    "projectId": {"type": "string", "minLength": 1},
    "idempotencyKey": {"type": "string", "minLength": 16, "maxLength": 200},
    "researchQuestion": {"type": "string", "minLength": 12, "maxLength": 4000},
    "decisionContext": {"type": ["string", "null"], "maxLength": 2000},
    "audience": {"enum": ["executive", "project-team", "researcher"]},
    "desiredSections": {"type": "array", "items": {"enum": ["question", "key-findings", "evidence-and-caveats", "risks", "open-questions", "next-steps"]}, "uniqueItems": true, "maxItems": 6},
    "evidencePolicy": {"enum": ["primary-only", "reviewed", "all"]},
    "freshnessRequirement": {"type": ["string", "null"], "maxLength": 500},
    "manualItemSegmentIds": {"type": "array", "items": {"type": "string", "minLength": 1}, "uniqueItems": true, "maxItems": 100},
    "deadline": {"type": ["string", "null"], "format": "date-time"}
  }
}
```

The authenticated run context is a separate server-only object; the caller cannot populate or override these values:

```json
{
  "actorId": "authenticated-user-id",
  "principalId": "authorization-principal-id",
  "orgId": "authorized-org-id",
  "projectAuthorizationDecisionId": "current-project-read-decision-id",
  "projectPolicyRevision": "trusted-project-policy-revision",
  "workflowVersionId": "published-immutable-workflow-version",
  "runId": "server-created-run-id",
  "digitalHumanVersionId": "selected-published-digital-human-version",
  "graphRevision": "immutable-composition-digest",
  "skillPins": [{"skillId": "S003", "skillVersionId": "immutable-version-id", "origin": "workflow-inherited"}]
}
```

The validated caller payload is combined with trusted bound context for idempotency. Canonicalize the schema-validated payload (stable key ordering, explicit defaults/nulls, normalized date-time strings), then hash `{payload, actorId, principalId, orgId, authorizedProjectId, projectAuthorizationDecisionId, projectPolicyRevision, workflowVersionId, digitalHumanVersionId, graphRevision, skillPins}`. Store this digest under the caller's idempotency key within the authenticated org/actor namespace. Same key + same digest returns the existing run; same key + different digest is a conflict. Client-provided actor/principal/org identity, authorization decisions, policy revision, versions, graph digest, pins or run ID are rejected as additional properties.

The W001 envelope's selected project scope is passed to the existing Context Pack operation as the single `projectId`. The operation request itself must conform exactly to `packages/contracts/src/context-pack.ts`: `runId`, `orgId`, `projectId`, `principalId`, `task`, `query`, optional positive `tokenBudget`, `evidencePolicy`, nullable `freshnessRequirement`, and `manualItemSegmentIds`. W001 maps the question to `query`, sets `task: "research"`, and supplies only run-bound identities; it must not add `tenantId`, arbitrary `sourceTypes`, a custom connector list, a caller-authored ACL, or a separate channel plan. The Context Engine derives the authorized project scope and planned retrieval channels. A `null` project in the Context Pack API is not permission to widen scope; this workflow requires a selected project.

## 4. Run states and terminal contract

Proposed workflow state machine (not yet wired to a W001 runtime). The plan gate is decided from caller input and trusted policy metadata before any retrieval, source access, or model call:

```text
created → awaiting_plan_confirmation? → gathering → running → verifying → completed
    ├────────────────────────────────────────────────────────────────────────────→ failed | cancelled
awaiting_plan_confirmation / running → paused → (resume to the recorded checkpoint after authorization recheck)
```

The plan gate is required before any `POST /context-packs` request or Skill/model call when the question asks for a recommendation to a named decision, requests `evidencePolicy: "all"`, or trusted project policy requires confirmation. Trusted policy metadata is resolved by authorization at run acceptance, not retrieved from project evidence by this workflow. The gate displays the exact question, one project, evidence policy, planned Context Pack task, allowed output sections, and the five resolved Skill version pins. Approval only confirms this bounded read/synthesis plan; it does not approve a recommendation or external action. If no gate applies, W001 proceeds directly from `created` to `gathering`. A pending gate expires after 7 days as a proposed default; resume revalidates access and keeps the same immutable run snapshot.

The final human gate is required before export, publication, external sharing, or any future write to a canonical decision/claim store. Those effects are outside the current W001 workflow, so the normal terminal is a private draft for caller review. The reviewer can approve the draft for the caller's next action, request correction, or reject it; W001 itself emits no public-send/publish call.

Execution terminal enum: `completed | failed | cancelled`. `paused` and `awaiting_plan_confirmation` are resumable nonterminal states. A completed output has one of these outcomes: `ready_for_review | insufficient_evidence | needs_specialist_review | no_citable_evidence`. `no_citable_evidence` is a deterministic completed terminal with **no brief and no LLM/S171/S063/S010/S020 call** when the Context Pack AI gate reports `EMPTY_CANDIDATE_SET`. Permission, retrieval, confidentiality, or malformed-pack failure is a failed run, not a completed brief with invented empty evidence. Cancellation is terminal for this run; already persisted events are not erased.

Each run event/checkpoint should capture run/version IDs, graph revision, Skill pins and origins, stage status, timestamps, attempt number, model profile, tool/context operation snapshot, input/output references, approval receipt, omissions and structured error. The generic execution-journal contract exists in main, but W001 event persistence and replay have not been verified as wired.

## 5. Stage plan

Every stage below is proposed W001 orchestration. Only the underlying Context Pack contract and generic Skill/runtime interfaces are present; there is no verified W001 stage runner. “Tool category” describes the intended WorkspaceX port, not a provider connector or an already callable workflow tool. Side-effect classes: **R** protected read; **M** model computation; **L** internal run/audit ledger; **A** derived artifact draft; **E** external effect (none in this workflow).

| # / stage | Exact Skill(s) | Input refs → output refs | Tool category and current/proposed boundary | State transition | Side-effect class and gate |
|---|---|---|---|---|---|
| 1. Accept and bind | none | caller payload + auth context → validated request hash, immutable run snapshot, five pins | Current authenticated request context; proposed W001 trigger adapter. Validate caller-selected project, payload, current invocation authorization, idempotency key; resolve selected W/D/S versions before any retrieval/model call. | `created → awaiting_plan_confirmation` when plan gate condition is true; otherwise `created → gathering`; unresolved access/version/hash conflict → `failed`. | L proposed. No source access until any required plan receipt exists. |
| 2. Confirm plan when required | none | bound run snapshot → plan approval receipt | Proposed human-review UI/plan port; no external notification channel assumed. | `awaiting_plan_confirmation → gathering` on explicit approve; denial/expiry → `cancelled`. | L proposed. Receipt binds exact question, selected project, evidence policy, allowed sections, graph digest and pins. No evidence retrieval or model call happens before approval. |
| 3. Gather authorized evidence | S003 Enterprise Search | question + bound scope/policy/manual IDs → `ContextPack` (`packId`, `items[]`, `claims[]`, `omissions[]`, `retrievalPlan[]`) | Existing Context Pack contract `POST /context-packs`; one operation for this task. Query task is `research`; the API internally determines `retrievalPlan[]`. Runtime route/provider deployment must still be checked; do not add a parallel search API. | `gathering → running` only on schema-valid pack; formal operation errors → `failed`. | R; Context Pack assembly is a protected read. Recheck permission at protected reads. No other project or public web reads. |
| 4. Apply pre-model gate | none (deterministic API operation) | `pack.runId` → `{allowed, blockReason}` | Current contract `POST /context-packs/:runId/ai-gate`; call before any downstream Skill/model invocation. | `running → completed` with `no_citable_evidence` on `allowed:false, blockReason:EMPTY_CANDIDATE_SET`; `running → failed` for other denied reasons; only `allowed:true` proceeds. | R + L proposed. Empty/uncitable evidence creates a no-brief result; no S171/S063/S010/S020 or LLM call. |
| 5. Assess sources and evidence | S171 Evidence Review | pack `items[]/claims[]/omissions[]` → validated `EvidenceLedger` (§6) | Proposed Skill call consumes only pack refs and policy metadata. It cannot fetch raw files or decide ACLs itself. | `running → running`; validate every ledger ref against the pack before persisting. | M + L proposed. Invalid ID/anchor/status → one schema repair; still invalid → `failed`. |
| 6. Synthesize findings | S063 Research Synthesis | validated `EvidenceLedger` → themes, findings, disagreement and evidence gaps | Proposed Skill call; preserve separate themes, source disagreements, dates, sample limitations and unknowns. | `running → running`; validator rejects unsupported material statement; one repair against same inputs, then `failed`. | M + L proposed. No new search/tool call is implied. |
| 7. Identify risk and uncertainty | S010 Risk Assessment | validated findings + matching ledger refs → risk entries | Proposed Skill call; use only findings and cited pack evidence. Risk labels describe exposure/uncertainty, not a regulated professional conclusion. | `running → running`; unresolved high-impact contradiction sets output `needs_specialist_review`. | M + L proposed. No action is executed from a risk finding. |
| 8. Draft for audience | S020 Executive Briefing | validated ledger + findings + risks + audience → brief JSON, including summary refs | Proposed Skill call; schema and reference validator runs before return. | `running → verifying`; malformed output gets one schema repair attempt then `failed`. | M + L proposed. Draft is not published and contains no new citations outside the pack. |
| 9. Verify, record, return | none (deterministic validator) | brief + exact pack + run snapshot → validated result envelope | Proposed schema, reference-integrity and policy validator; a future Artifact adapter may save a private draft if a signed artifact contract is available. | `verifying → completed` for valid review draft; `failed` for pack/permission/version integrity violation. | R + L; A only if separately implemented as private draft with receipt. No E. Output review is not approval to publish. |

## 6. Evidence and permission rules

The current Context Pack input contract defines `EvidencePolicy` as `primary-only | reviewed | all`, `QueryTask` including `research`, and a response comprising `items[]`, `claims[]`, `omissions[]`, query scope, retrieval plan, token count and nullable `pinnedSnapshotId`. Each item carries `segmentId`, `artifactVersionId`, an anchor, `permissionDecisionId`, `sourceType`, channels and retrieval reasons. W001 stores these exact identifiers with the draft; a human-readable citation label is display text and never replaces the identifiers.

### Intermediate `EvidenceLedger` schema

S171 receives one validated Context Pack and returns a structured ledger; it does not return an alternate source list or fetch material. This is a proposed W001 stage contract, not a current Skill output schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "runId", "packId", "entries", "claimRefs", "omissionRefs"],
  "properties": {
    "schemaVersion": {"const": "W001-EvidenceLedger/1"},
    "runId": {"type": "string"},
    "packId": {"type": "string"},
    "entries": {"type": "array", "items": {"type": "object", "additionalProperties": false, "required": ["entryId", "segmentId", "artifactVersionId", "permissionDecisionId", "anchor", "supportRelation", "qualityAssessment", "qualityBasis", "limitations"], "properties": {"entryId": {"type": "string"}, "segmentId": {"type": "string"}, "artifactVersionId": {"type": "string"}, "permissionDecisionId": {"type": "string"}, "anchor": {"type": "object"}, "supportRelation": {"enum": ["supports", "contradicts", "context-only", "exclude-from-support"]}, "qualityAssessment": {"enum": ["adequate", "qualified", "insufficient", "unknown"]}, "qualityBasis": {"type": "string", "minLength": 1}, "limitations": {"type": "array", "items": {"type": "string"}}}}},
    "claimRefs": {"type": "array", "items": {"type": "object", "additionalProperties": false, "required": ["statement", "status", "supportingSegmentIds", "contradictingSegmentIds"], "properties": {"statement": {"type": "string"}, "status": {"enum": ["proposed", "reviewed", "accepted", "contested", "superseded"]}, "supportingSegmentIds": {"type": "array", "items": {"type": "string"}}, "contradictingSegmentIds": {"type": "array", "items": {"type": "string"}}}}},
    "omissionRefs": {"type": "array", "items": {"type": "string"}}
  }
}
```

The deterministic validator constructs the allowed evidence index directly from the received `pack.items[]` and checks each ledger entry's `(packId, segmentId, artifactVersionId, permissionDecisionId, anchor)` against one exact item. The anchor must deep-equal that item's returned anchor; missing, changed or fabricated coordinates fail validation. `qualityAssessment` and `qualityBasis` are S171 analysis, not source metadata: the Skill must say when provenance, date, method or attribution is absent, and cannot claim those fields were present unless the Context Pack provides them. Each `claimRefs` tuple must match one exact pack claim, including status and supporting/contradicting IDs. Each omission ref must match an exact `pack.omissions[].ref`. No Skill-generated statement may add an ID, claim, source date, source author or anchor absent from the pack. The stored ledger and every later stage input include the `runId`, `packId`, and validated ledger digest.

- Only `ContextPack.items[]` returned for this run may support a cited factual finding. Every material statement in the S063 synthesis, S010 risk analysis, S020 executive summary, and individual findings must carry at least one `EvidenceRef`; a deterministic validator checks every tuple and exact anchor against both the Context Pack and accepted EvidenceLedger. If there is no supporting ref, the output may state only that the question is unanswered / evidence is unavailable; it cannot make an uncited substantive claim.
- Keep source observations separate from synthesis and recommendation. A Context Pack `claims[]` entry is labeled by its returned status and retains supporting and contradicting IDs; `proposed` or `contested` is never rendered as an accepted fact. Do not cite an `ai-generated` item as primary evidence.
- Surface relevant `omissions[]` and known retrieval limitations. An omission may disclose that authorized material was unavailable, withdrawn, stale, or out of scope, but not reveal contents the caller cannot access. Do not reinterpret an omission as evidence that the proposition is false.
- `evidencePolicy` is passed unchanged to `POST /context-packs`; a Skill or model cannot broaden it. `manualItemSegmentIds` is empty unless the user explicitly selected those exact Segment IDs; unauthorized selected items fail the operation, not become silently omitted.
- `orgId`, `principalId`, and run ID come from the trusted request/run context. A Skill pin grants no data, project, connector, or tool access. Current access is checked by the API/identity boundary; revalidate before protected reads or writes and fail before the next protected action if access is revoked.
- Retrieved source text is untrusted data, not instructions. It cannot alter the question, identity, project scope, policy, Skill bindings, approval rules or side-effect permissions.
- A `ContextPack` is a per-task evidence snapshot, not a claim that this workflow can query all stores. For Phase 1, one Context Pack request is bound to one selected project. Multiple project synthesis requires an explicitly designed separate workflow/version and permission policy.

The ledger preserves Evidence Review's source-quality judgment as `qualityAssessment` plus its explicit basis and limitations, not as a permission decision or a new canonical claim status. It may not upgrade a Context Pack claim from `proposed`/`contested` to `accepted`, nor infer that an item is `primary` from its `sourceType` alone.

## 7. Output JSON

This is a proposed strict W001 run-result schema, not a current API contract. All `evidenceRefs` refer to exact `ContextPack.items[]` tuples from this run. `segmentId`, `artifactVersionId`, `permissionDecisionId`, `packId` and `anchor` must match one returned item exactly; `omissionRefs` must match returned omission refs. The result does not assert that an Artifact has been persisted.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["workflowId", "workflowVersionId", "runId", "status", "question", "scope", "asOf", "executiveSummary", "findings", "risks", "openQuestions", "evidenceRefs", "omissionRefs", "reviewRequired", "noBriefReason"],
  "properties": {
    "workflowId": {"const": "W001"},
    "workflowVersionId": {"type": "string"},
    "runId": {"type": "string"},
    "status": {"enum": ["ready_for_review", "insufficient_evidence", "needs_specialist_review", "no_citable_evidence"]},
    "question": {"type": "string"},
    "scope": {"type": "object", "additionalProperties": false, "required": ["orgId", "projectId"], "properties": {"orgId": {"type": "string"}, "projectId": {"type": "string"}}},
    "asOf": {"type": "string", "format": "date-time"},
    "executiveSummary": {"oneOf": [{"type": "object", "additionalProperties": false, "required": ["text", "evidenceRefs"], "properties": {"text": {"type": "string", "minLength": 1}, "evidenceRefs": {"type": "array", "minItems": 1, "items": {"$ref": "#/$defs/evidenceRef"}}}}, {"type": "null"}]},
    "findings": {"type": "array", "items": {"type": "object", "additionalProperties": false, "required": ["id", "statement", "classification", "confidence", "evidenceRefs", "caveat"], "properties": {"id": {"type": "string"}, "statement": {"type": "string", "minLength": 1}, "classification": {"enum": ["observation", "synthesis", "inference", "recommendation"]}, "confidence": {"enum": ["low", "moderate", "high", "not_assessed"]}, "evidenceRefs": {"type": "array", "minItems": 1, "items": {"$ref": "#/$defs/evidenceRef"}}, "caveat": {"type": ["string", "null"]}}}},
    "risks": {"type": "array", "items": {"type": "object", "additionalProperties": false, "required": ["statement", "likelihood", "impact", "evidenceRefs", "mitigationQuestion"], "properties": {"statement": {"type": "string"}, "likelihood": {"enum": ["low", "medium", "high", "unknown"]}, "impact": {"enum": ["low", "medium", "high", "unknown"]}, "evidenceRefs": {"type": "array", "minItems": 1, "items": {"$ref": "#/$defs/evidenceRef"}}, "mitigationQuestion": {"type": ["string", "null"]}}}},
    "openQuestions": {"type": "array", "items": {"type": "string"}},
    "evidenceRefs": {"type": "array", "items": {"$ref": "#/$defs/evidenceRef"}},
    "omissionRefs": {"type": "array", "items": {"type": "string"}},
    "reviewRequired": {"type": "boolean"},
    "noBriefReason": {"type": ["string", "null"], "enum": ["EMPTY_CANDIDATE_SET", null]}
  },
  "$defs": {
    "evidenceRef": {"type": "object", "additionalProperties": false, "required": ["segmentId", "artifactVersionId", "permissionDecisionId", "packId", "anchor"], "properties": {"segmentId": {"type": "string"}, "artifactVersionId": {"type": "string"}, "permissionDecisionId": {"type": "string"}, "packId": {"type": "string"}, "anchor": {"type": "object"}}}
  }
}
```

Cross-field validator requirements: (a) `ready_for_review`, `insufficient_evidence` and `needs_specialist_review` require a non-null summary with at least one valid citation, `noBriefReason:null`, and `reviewRequired:true`; `insufficient_evidence` may state only conclusions supported by citations plus explicit gaps. (b) `no_citable_evidence` requires `executiveSummary:null`, empty `findings`, `risks`, `evidenceRefs`, and `openQuestions`, `reviewRequired:false`, and `noBriefReason:"EMPTY_CANDIDATE_SET"`; it produces no brief. (c) Top-level `evidenceRefs` equals the deduplicated union of summary, finding and risk refs. Every material summary/finding/risk sentence needs one or more valid refs; no substantive statements may be placed in uncited caveats. (d) Every evidence tuple and anchor must deep-match one pack item and one validated ledger entry. A schema-valid but tuple-invalid output is rejected before `completed`.

Immediately after pack schema validation, the runner calls `POST /context-packs/:runId/ai-gate`, before invoking S171 or any LLM-backed Skill. If `allowed:false` and `blockReason:"EMPTY_CANDIDATE_SET"`, return the no-brief result above. Any other `allowed:false` is a failed run with the exact API reason; it does not call S171/S063/S010/S020. A retrieval/API error is a failed run, not a completed brief with invented empty evidence. Human review receipt and actual Artifact write receipt are execution/audit metadata, not silently added to this result schema.

## 8. Human gates and effect receipts

| Gate | Condition | Approve / deny effect | Receipt |
|---|---|---|---|
| Plan confirmation | Scope/policy condition in §4 is true. | Approve the exact read-only plan or cancel; edits to question, project, policy or manual items create a new plan revision and require a new approval. | `gateId`, `runId`, authenticated reviewer ID, decision, reviewed plan digest, graph/Skill pin digest, timestamp. Proposed; no W001 gate UI is verified. |
| Draft review | Always before caller treats result as approved briefing; separate from run completion. | Accept, request revision, or reject. Revision reuses source pack only if unchanged and still authorized; question/scope/evidence policy changes require a new run. | `reviewId`, `runId`, reviewer ID, output digest, decision, timestamp. Proposed. |
| Publish/share/write | Not part of W001. | No call is made. A future capability needs a distinct authorized Workflow/tool, recipient/scope confirmation, a human approval gate and a post-effect readback receipt. | No external effect receipt exists in W001. |

Never infer approval from silence, a chat “looks good” unrelated to an explicit gate, or approval of the plan as approval of the resulting findings. A gate decision is bound to one immutable digest; a changed draft invalidates a prior draft approval.

## 9. Idempotency, retries and crash recovery

1. Hash the canonical, schema-validated caller payload together with trusted actor/principal/org, server-authorized project and current authorization-decision ID, trusted project-policy revision, selected published W001 and DigitalHuman versions, graph revision, and resolved Skill pins. Scope the idempotency key to authenticated actor + org. Same key + same hash returns the existing run; same key + different hash is a conflict and starts no work.
2. Resolve/pin the complete W/S/D composition before first Skill or retrieval call. Persist the proposed run snapshot, request hash and `created` event atomically before dispatch. The resolver/snapshot service is currently unwired; execution is blocked until it exists.
3. Before S003, record a stable `runId` and context-request input hash. Retry only transient retrieval transport/dependency errors with bounded exponential backoff (maximum 3 attempts, 1/2/4 seconds plus jitter). Reuse the same run and exact request; do not mutate query/scope or create another logical run. Formal permission revocation, manual-item denial, confidentiality/model constraint, or schema errors are not retryable.
4. Record validated Context Pack `packId` and digest before invoking synthesis. A crash after pack assembly resumes from that recorded pack only if it remains replayable under the current authorization check. If permission changed, stop; do not regenerate using a wider scope or a newer graph/Skill version.
5. Skill/model calls are computation, but an ambiguous timeout may have completed. Store stage attempt and deterministic output digest before advancing. Retry a failed/invalid structured output once using the same inputs and pins; keep attempts in audit. Do not duplicate a verified stage output after a checkpoint exists.
6. If a private draft Artifact adapter is later added, use a stage-specific idempotency key derived from run ID + output digest. Write a pending effect record before creating the draft; reconcile by idempotency receipt/readback after timeout. Without a verified create/read API and receipt semantics, do not auto-save; return the draft inline. There are no compensating or external write actions in this version.
7. Resume from `paused` or a human gate only after reauthorizing the caller and checking the exact recorded D/W/S pins, graph digest, pack and approval digest. Never re-resolve `latest`. If a recorded pin or pack cannot be read, fail closed. Cancellation prevents later stages but cannot erase already-written run/audit records.

These are required Workflow semantics, not claims that current main has a W001 durable DAG, event trigger adapter, checkpointed Skill-stage runner, or human gate integration. Existing research and interview checkpoint systems are domain-specific and are not a generic W001 runtime.

## 10. Workflow-specific evaluation

Run a fixed, synthetic, authorized single-project fixture suite. Assert schemas and identifiers, not only prose similarity. Targets are proposed release gates; no passing measurements have been run for W001.

| Case | Fixture / assertion | Threshold |
|---|---|---|
| Evidence trace | 40 material factual statements across 10 briefs, each mapped to actual pack item IDs and anchors. | 100% of material facts cite an in-pack ref; 0 fabricated/out-of-pack IDs. |
| Contradictory evidence | 20 packs with opposed dated sources and at least one `contested` or `proposed` claim. Preserve both sides, source dates and caveat; do not collapse into a single accepted fact. | ≥95% of adjudicated contradictions visible; 0 contested claims labeled accepted. |
| Permission boundary | 30 cross-project/private Segment canaries, including a revocation between stages. | 0 canary content or identifiers disclosed; 100% of revocation cases stop before next protected read/write. |
| Evidence policy | 30 matched `primary-only`, `reviewed`, and `all` inputs. Request and output reflect the selected policy; missing-source cases are omissions, not negative facts. | 100% policy pass; 0 caller/model widening. |
| Empty vs unavailable | 10 successful Context Packs that the main `ai-gate` reports as `EMPTY_CANDIDATE_SET`, plus 10 retrieval errors. Empty packs return `no_citable_evidence` with no brief and zero downstream Skill/LLM calls; retrieval errors fail the run. | 100% state distinction; 0 downstream calls on empty gate. |
| Risk calibration | 40 fixed evidence-backed risk assertions reviewed by two domain reviewers. Each includes likelihood/impact or `unknown`, a cited premise or explicit unknown, and no unrequested mitigation execution. | ≥90% agreement on risk category; 0 external side effects. |
| Duplicate trigger | 20 same-key/same-payload duplicates plus 10 same-key/changed-payload collisions. | Exactly one logical run per duplicate group; all changed-payload collisions rejected. |
| Crash/replay | Inject crash after snapshot, after pack persistence, at each Skill return, while awaiting review, and during a simulated draft-write timeout. | Resume same run/same pins; no duplicate effect; changed authorization/pin/pack fails closed. |
| Output contract | 100 generated results include wrong enum, nullability, malformed anchor, invalid ref and extra-field mutations. | 100% invalid mutations rejected before `completed`. |
| Review integrity | Approve a plan, then mutate question; approve a draft, then mutate output. | Old receipts authorize neither changed plan nor changed draft in 100% of cases. |

## 11. Source strategy and provenance

This v2 requirement uses **Clean-room Rewrite**. Its stage order, schemas, state names, evidence rules and evaluation thresholds are authored from WorkspaceX's own graph, Context Engine contracts and run architecture. No third-party workflow/template implementation or method artifact is relied on for this specification; no external code, workflow JSON, connector behavior or prose is adopted. The previous v1 `A3 Cross-platform Rebuild` label is not carried forward as evidence of research. If implementation later relies on an external workflow/template, its exact artifact path, immutable commit, artifact-level license and the specific relied-on behavior must be reviewed and recorded before that implementation is treated as ready.

## 12. WorkspaceX source anchors and blockers

Baseline is main `d988b843c798862c4f76180a2ef390ad13ef323d`:

- `docs/architecture/context-engine.md`: Artifact → Version → Segment → Anchor evidence model, authorization-filtered context, and Context Pack boundary. It describes architecture; it does not prove every source channel is deployed.
- `packages/contracts/src/context-pack.ts`: exact `assembleContextPack` operation, strict input, output and error names for `POST /context-packs`; response Context Pack has `items[]`, `claims[]`, `omissions[]`, `retrievalPlan[]`, `tokensUsed`, and `pinnedSnapshotId`.
- `apps/api/src/application/skill/resolve-runtime-context.ts`: Skill context port requests a pack and intersects declared scope with returned scopes; this is a Skill runtime path, not a W001 workflow runner.
- `packages/contracts/src/execution-journal.ts`: generic execution event schema; no inspected binding to W001 stages or the closure snapshot.
- `phases/requirements/work-stack-v1/workflows/WF-001-research-to-brief.md`: previous broad requirement, narrowed here to a one-project, read-first Phase 1 slice and the exact v2 matrix closure.
- `/workspace/scratch/eea507eb39e6/EXECUTION-SKILL-CLOSURE.md`: proposed D/W/S resolver and pin-origin contract; unwired on main.

**Blockers before implementation-ready:** (1) pin immutable versions for all five Skills and publish a versioned W001 binding; (2) implement/test the selected-DigitalHuman + W001 closure resolver and run snapshot/origin recording; (3) implement a W001 durable stage runtime and human gates using the server-side run/event source of truth; (4) verify actual `POST /context-packs` route, providers, policy enforcement and retrieval availability in the target deployment; (5) settle whether the successful result is inline only or save a private Artifact, with an exact authorized API and idempotency receipt. Until those close, this file is a proposed design, not an executable workflow or production capability.

**Changed file:** `drafts/W001-research-to-brief.md` only.
