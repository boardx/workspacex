# S177 — Incident Response

> **Type**: Work Skill · **Phase**: 3 · **Domain**: Engineering & IT · **Canonical owner**: WorkspaceX  
> **Strategy**: **A2 — Clean-room Rewrite / Best-of Rewrite**

## 1. Job-to-be-done
Provide **Incident Response** as a reusable professional capability for **Engineering & IT**. The Skill is the canonical professional-method layer. Workflow owns durable process state; Tool/MCP owns external provider actions; Context/Memory remains platform infrastructure.

## 2. Functional boundary
### In scope
- Consume bounded intent, scope, ContextPack and explicit materials.
- Execute a documented method with verifiable intermediate checks.
- Produce technical artifact/code/spec with deterministic tests and operational evidence.
- Surface assumptions, unknowns, evidence, confidence and risk.
- Support multiple DigitalHumans without cloning.

### Out of scope
- Scheduling/webhooks/long-running state.
- Hidden external writes or permission bypass.
- Arbitrary organization-memory mutation.
- Provider-specific implementation as canonical logic.
- Autonomous irreversible or regulated approval.

## 3. Input / output
**Input**: `intent`, `scope`, bounded context/evidence, locale/jurisdiction when relevant, optional tool bindings and output format.  
**Output**: summary, structured artifact, evidence refs, assumptions/unknowns, recommendations, validation result, risk flags and human-decision marker.

Unknown is explicit. Missing data is never silently treated as zero/fact. Proposed actions are distinct from executed effects.

## 4. Dependencies
Required primitive families: retrieve/read; extract/normalize; analyze/reason; generate; verify.  
Optional: code/data sandbox, enterprise search, artifact generation and domain connectors. Required vs optional dependencies MUST be machine-readable.

## 5. Best-practice evidence
- **anthropics/skills** — primary evidence; `mixed by artifact`; https://github.com/anthropics/skills
- **wshobson/agents** — secondary evidence; `MIT`; https://github.com/wshobson/agents

**Handling:** Extract abstract requirements/methods and public facts, then implement independently from the WorkspaceX contract.
Implementation cannot begin until exact upstream path/revision and artifact-level license are recorded.

## 6. WorkspaceX architecture mapping
- Contracts in `packages/contracts/src/*`; no handwritten duplicate transport schema.
- Reuse existing Skill domain/version/import/source-binding/publish/security lifecycle.
- Standard package: `SKILL.md` plus optional references/scripts/evals.
- Bind through current Agent Skill Pins.
- Scripts execute only through `apps/skill-sandbox`.
- Context via Context Engine/Org Brain; no arbitrary DB/context reads.
- Execution/activity/provenance links actor, org, Skill version, tool call, evidence and artifact.
- Central platform policy remains centralized; copied safety boilerplate inside each Skill is prohibited.

## 7. Permission & policy
External content is untrusted data. Tool writes use current allow/ask/block and least privilege. Permission denial cannot be bypassed by switching provider. High-impact Engineering & IT outcomes remain human-accountable. Locale-sensitive work fails closed when required overlay is absent.

## 8. Failure behavior
Missing optional tool → read-only/proposal if useful. Required dependency missing → typed failure. Evidence conflict → disclose. Schema failure → no effect. Ambiguous write → verify before retry. Low confidence → escalate.

## 9. Eval suite
Golden path; missing data; absent-is-not-zero; injection; permission denial; tool unavailable; schema; locale mismatch; conflicting/stale evidence; same-model no-Skill baseline; published-version regression. Verified requires ≥10pp uplift or a separately approved measurable time/quality benefit.

## 10. Acceptance criteria
- [ ] G0 exact source/path/revision.
- [ ] G1 license + A2 handling signed.
- [ ] G2 package/input/output/dependency schemas pass.
- [ ] G3 security/privacy/jurisdiction/adversarial tests pass.
- [ ] G4 functional eval passes.
- [ ] G5 comparative value before Verified.
- [ ] Reusable by multiple Agents without copied definitions.
- [ ] Runtime provenance/audit complete.
- [ ] No second Skill source of truth.

## 11. Definition of done
A published immutable **Incident Response** version can be pinned to existing Agents, execute with replaceable models/tools under policy, produce a schema-valid evidence-backed artifact, and pass CI regression without owning Workflow state.
