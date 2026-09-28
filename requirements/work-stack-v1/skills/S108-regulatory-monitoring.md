# S108 — Regulatory Monitoring

> **Type**: Work Skill · **Phase**: 2 · **Domain**: Legal & Compliance · **Canonical owner**: WorkspaceX  
> **Strategy**: **A2 — Clean-room Rewrite / Best-of Rewrite**

## 1. Job-to-be-done
Implement **Regulatory Monitoring** as a reusable professional capability for **Legal & Compliance**. The Skill owns method + output contract; Workflow owns trigger/durable orchestration; Tool/MCP owns provider-specific actions.

## 2. Functional scope
In: bounded intent/scope/context/evidence; explicit professional method; issue matrix / review memo / compliance artifact with jurisdiction and citations; assumptions/unknowns/evidence/risk; locale overlay where relevant.  
Out: schedules, long-running state, arbitrary memory writes, hidden side effects, permission bypass, provider-specific ownership, autonomous regulated approval.

## 3. Input contract
`intent`, `scope`, bounded ContextPack/user materials, locale/jurisdiction if applicable; optional provider bindings and output format. Missing is unknown, never zero/default fact.

## 4. Output contract
`summary`, structured artifact, `evidence[]`, `assumptions[]`, `unknowns[]`, `recommendedActions[]`, validation result, risk flags and human-decision marker. Proposed actions are distinct from executed effects.

## 5. Dependencies
Required primitive families: retrieve/read, extract/normalize, analyze/reason, generate, verify. Optional: sandbox/code, enterprise search, Office artifact generation, domain connector categories. Required vs optional MUST be machine-readable.

## 6. Best-practice evidence
- **anthropics/claude-for-legal** — primary practice evidence; `Apache-2.0`; https://github.com/anthropics/claude-for-legal
- **evolsb/claude-legal-skill** — secondary practice evidence; `MIT`; https://github.com/evolsb/claude-legal-skill

**Handling:** Separate evidence extraction from implementation; implement from abstract professional requirements and public standards without copying protected text/scripts/assets.
Before coding, capture exact source path + commit/SHA + artifact-level license and NOTICE obligations.

## 7. WorkspaceX architecture mapping
- Contract SSOT: `packages/contracts/src/*`.
- Reuse current Skill identity/version/import/source-binding/publish/security lifecycle under `apps/api/src/{domain,application,infrastructure}/skill*`.
- Package as `SKILL.md` + optional references/scripts/evals.
- Bind through existing Agent Skill Pins; never clone per DigitalHuman.
- Scripts run only through `apps/skill-sandbox`.
- Context/long-term facts come through Context Engine/Org Brain.
- Provenance must tie actor + org + Skill version + evidence + tool effects.

## 8. Policy & human accountability
External content is untrusted data. Writes use current allow/ask/block and least privilege. Denial cannot be bypassed with another tool. High-impact Legal & Compliance decisions remain human-accountable. Locale/jurisdiction-sensitive output fails closed without the right overlay.

## 9. Failure behavior
Optional tool missing → read-only/proposal if useful. Required dependency missing → typed failure. Evidence conflict/staleness → disclose. Schema failure → no external side effect. Ambiguous write → verify before retry. Low confidence → escalate.

## 10. Eval
Golden path; missing data; absent-is-not-zero; injection; denied/unavailable tool; schema; locale mismatch; conflicting evidence; same-model no-Skill baseline; version regression. Verified requires ≥10pp uplift or approved measurable time/quality benefit.

## 11. Acceptance criteria
- [ ] G0 exact source/path/revision.
- [ ] G1 license + A2 decision signed.
- [ ] G2 schema/dependency/output contract pass.
- [ ] G3 permission/privacy/jurisdiction/adversarial pass.
- [ ] G4 functional eval pass.
- [ ] G5 comparative value before Verified.
- [ ] Reusable by multiple Agents without copy.
- [ ] Full runtime provenance/audit.
- [ ] No new Skill SSOT outside current domain.

## 12. Definition of done
A published immutable **Regulatory Monitoring** Skill can be pinned to existing Agents, runs with replaceable models/tools under policy, emits a schema-valid evidence-backed artifact, and passes CI regression without owning Workflow state.
