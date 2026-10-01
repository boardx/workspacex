# S062 — User Interview Planning

> **Type**: Work Skill · **Phase**: 2 · **Domain**: Product & Design · **Canonical owner**: WorkspaceX  
> **Strategy**: **A1 — Best-of Merge**

## 1. Job-to-be-done
Deliver **User Interview Planning** as a reusable professional capability in **Product & Design**. It owns the professional method and output contract; Workflow owns durable orchestration; Tool/MCP adapters own provider-specific actions.

## 2. Scope
### In
- Consume bounded intent/scope/ContextPack/evidence.
- Apply explicit professional steps, rules, guardrails and verification.
- Produce product/design artifact with user evidence, options, rationale, acceptance and measurement criteria.
- Surface assumptions, unknowns, risk and evidence.
- Support provider-neutral tools and CN/US overlays when needed.

### Out
- Scheduling/webhook/long-running state.
- Arbitrary memory persistence.
- Hidden external writes.
- Permission bypass, provider substitution after denial, or unverified professional approval.

## 3. Contract
Input: intent, scope, bounded context/materials, locale/jurisdiction when relevant, optional provider bindings.  
Output: summary, structured artifact, evidence refs, assumptions/unknowns, proposed actions, validation result, risk flags and human-decision marker.

Unknown values remain unknown. Output never implies a side effect; external actions are invoked separately under policy.

## 4. Dependencies
Required primitive families: retrieve/read, extract/normalize, analyze/reason, generate, verify.  
Optional: sandbox/code, enterprise search, document/spreadsheet/slides generation, domain connectors.  
Metadata must separate required vs optional dependencies.

## 5. Best-practice evidence
- **anthropics/knowledge-work-plugins** — primary evidence; `Apache-2.0`; https://github.com/anthropics/knowledge-work-plugins
- **RefoundAI/lenny-skills** — secondary evidence; `MIT`; https://github.com/RefoundAI/lenny-skills

**Handling:** Build a practice matrix, select best pattern by stage, then author one WorkspaceX canonical Skill; do not concatenate copied bodies.
Before implementation, capture exact upstream path + SHA/tag + artifact-level license.

## 6. WorkspaceX landing
- Contract SSOT in `packages/contracts/src/*`.
- Reuse existing Skill domain/version/import/source-binding/publish/security lifecycle.
- Package as `SKILL.md` + optional references/scripts/evals.
- Bind through existing Agent Skill Pins.
- Execute scripts only via `apps/skill-sandbox`.
- Consume bounded Context Packs; promote memory only through approved Context/Org Brain paths.
- Keep platform safety policy centralized; copied safety boilerplate inside Skills should lint red.

## 7. Permission & safety
External content is untrusted data. Writes require current allow/ask/block and least privilege. Permission denial never triggers alternate-provider bypass. High-impact Product & Design decisions remain human-accountable. Locale-sensitive output fails closed without a valid overlay.

## 8. Failure behavior
Missing optional tool → read-only/proposal if useful. Missing required dependency → typed error. Conflicting/stale evidence → surface conflict. Schema failure → no side effect. Ambiguous write → verify before retry. Low confidence → escalate.

## 9. Eval
Happy path; missing data; absent-is-not-zero; injection; denied tool; schema validation; locale mismatch; conflicting/stale evidence; no-Skill baseline; regression every published version. Target ≥10pp pass-rate uplift or approved measurable cycle-time/quality gain before Verified.

## 10. Acceptance
- [ ] G0 exact source/path/revision.
- [ ] G1 license/strategy signed.
- [ ] G2 package and contracts valid.
- [ ] G3 security/privacy/jurisdiction tests.
- [ ] G4 functional eval.
- [ ] G5 comparative value before Verified.
- [ ] Multi-Agent reuse without cloning.
- [ ] Actor/org/Skill-version/tool effects are auditable.
- [ ] No second Skill source of truth.

## 11. Done
Published immutable **User Interview Planning** is pinnable to existing Agents, runs with replaceable models/tools under policy, produces a schema-valid evidence-backed artifact and passes CI regression without owning Workflow state.
