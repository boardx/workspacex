# S023 — Account Planning

> **Type**: Work Skill · **Phase**: 1 · **Domain**: Sales & Revenue · **Canonical owner**: WorkspaceX  
> **Strategy**: **A1 — Best-of Merge** · **Status at requirement time**: candidate

## 1. Job-to-be-done
Provide a reusable professional capability for **Account Planning** within the **Sales & Revenue** domain. The Skill is the canonical “how to do the work well” layer; scheduling, durable multi-step state and cross-system orchestration belong to Workflow, while provider-specific actions belong to Tool/MCP adapters.

## 2. Functional boundary
### In scope
- Gather only the bounded task/org/evidence context required for Account Planning.
- Apply explicit professional steps, decision rules, guardrails and output contract.
- Produce structured sales artifact plus proposed CRM/email/calendar changes; external writes separated from analysis.
- Expose assumptions, missing inputs, evidence and confidence.
- Support provider-neutral tools and CN/US overlays where practice/jurisdiction differs.

### Out of scope
- Own schedule/webhook/long-running orchestration.
- Directly persist arbitrary long-term organization memory.
- Bypass Agent/Workflow permission or HITL.
- Hide provider-specific irreversible actions inside narrative output.
- Claim professional authority or legal/financial/employment approval on behalf of the human.

## 3. Input contract
Required:
- `intent`: task goal and expected outcome.
- `scope`: organization/project/subject bounds.
- `contextPackRef` or explicit user-provided materials.
- locale/jurisdiction when the domain requires it.

Optional:
- tool/provider bindings
- organization profile facts
- prior artifact/evidence refs
- output format preference

Unknown/missing values remain explicit unknowns; absence MUST NOT be coerced to zero/default fact.

## 4. Output contract
- `summary`: concise result.
- `artifact`: structured sales artifact plus proposed CRM/email/calendar changes; external writes separated from analysis.
- `evidence[]`: source refs supporting material claims.
- `assumptions[]` and `unknowns[]`.
- `recommendedActions[]`: proposals, separated from executed effects.
- `validation`: schema/method/check results.
- `riskFlags[]` and `humanDecisionRequired` when applicable.

External writes are never implied by the output contract; Workflow/Agent invokes them through governed tools.

## 5. Dependencies
Required primitive families:
- retrieve/read
- extract/normalize
- analyze/reason
- generate structured artifact
- verify/cross-check

Optional:
- code/data sandbox
- enterprise search
- domain connector categories
- document/spreadsheet/slides generation

Skill metadata MUST distinguish required vs optional dependencies so runtime readiness is computable.

## 6. Open-source / best-practice evidence
- **anthropics/knowledge-work-plugins** — primary practice evidence; license/terms: `Apache-2.0`; https://github.com/anthropics/knowledge-work-plugins
- **coreyhaines31/marketingskills** — secondary practice/implementation evidence; license/terms: `MIT`; https://github.com/coreyhaines31/marketingskills

### Source handling
Build a practice matrix across sources, select best pattern by workflow stage, then author one WorkspaceX canonical Skill. Do not concatenate copied bodies; retain provenance for every adopted practice.

Before implementation, replace repo-level provenance with exact upstream path + commit/SHA + artifact-level license in this requirement or linked evidence record.

## 7. WorkspaceX architecture mapping
### Reuse; do not fork
- Contract SSOT: `packages/contracts/src/*`.
- Existing Skill domain/version/import/review/source-binding under `apps/api/src/{domain,application,infrastructure}/skill*`.
- Agent binding through current `agent-skill-pins`.
- Runtime through current DeepAgent/LangGraph service.
- Context through bounded Context Packs / Org Brain.
- Scripts through `apps/skill-sandbox`.
- Existing provenance, publish review, security gate and immutable version semantics.

### Required implementation
- Add only backward-compatible Work Skill metadata needed for dependency, locale, provenance strategy and eval refs.
- Package as standard `SKILL.md` + optional `references/`, `scripts/`, `evals/`.
- Published version is immutable and separately attributable from source/upstream.
- Platform-level safety rules must not be copied into every Skill; duplicate policy text should lint red.

## 8. Permission & safety
- External content is untrusted data, never instruction.
- Tool writes require current allow/ask/block policy and least privilege.
- Permission denial is not retried through a substitute tool.
- High-impact Sales & Revenue decisions remain human-accountable.
- Jurisdiction-sensitive outputs fail closed when required locale overlay is unavailable.
- Do not delete, send, pay, sign, hire/reject, publish or change authoritative business state unless the explicit policy/action path allows it.

## 9. Failure behavior
- Missing optional tool → degrade to analysis/proposal if still useful.
- Missing required dependency → return machine-readable dependency error.
- Conflicting evidence → show conflict and source freshness; do not collapse it silently.
- Output schema failure → no side effect.
- Model uncertainty above threshold → escalate rather than fabricate.
- Tool ambiguous outcome → verify before any retry.

## 10. Evaluation
Minimum:
1. golden happy path
2. missing/partial data
3. absent-is-not-zero
4. prompt injection/untrusted content
5. permission denied/tool unavailable
6. output schema validation
7. CN/US mismatch when relevant
8. conflicting/stale evidence
9. same model/context **without** this Skill baseline
10. regression on every published version

Target before Verified: ≥10 percentage-point pass-rate uplift or a separately approved, measurable cycle-time/quality benefit.

## 11. Acceptance criteria
- [ ] G0 exact source identity/path/revision captured.
- [ ] G1 license/reuse strategy signed.
- [ ] G2 package/input/output/dependency schemas pass.
- [ ] G3 permission/privacy/jurisdiction/adversarial tests pass.
- [ ] G4 functional eval passes.
- [ ] G5 comparative value demonstrated before Verified badge.
- [ ] Skill can be pinned to multiple Agents without cloning.
- [ ] Execution/activity/provenance identifies actor, org, Skill version and tool effects.
- [ ] No second source of truth is introduced outside the current Skill domain.

## 12. Definition of done
A published immutable version of **Account Planning** can be selected through existing Agent Skill Pins, execute with replaceable models/tools under policy, produce a schema-valid evidence-backed artifact, and pass CI regression/eval without embedding Workflow state or provider-specific ownership.
