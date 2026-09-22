# Survey report chapter interpretation — #3803

## Behavior
Each template section can enable/disable interpretation. The compiler derives findings, evidence and follow-up actions solely from validated, visible aggregates. Single-answer scale results describe respondent feedback, not an organization-wide diagnosis. Compatible scale items are summarized together. Ranking uses lower mean rank first; distribution describes actual selections without summing multi-select counts into a sample size. Open text stays quoted evidence. No external benchmarks or causal claims are generated.

Existing saved reports remain readable; regenerate to obtain interpretation. Template order, bindings and block types remain authoritative. Word includes the same persisted interpretation; print uses the report document only.

## Validation
- Contracts: 81 files / 836 tests passed, including single response, opt-out, incompatible scales, suppressed groups, plural sample counts, ranking and open feedback.
- Web report/chart tests: 12 tests passed; Word XML asserts interpretation evidence/action content.
- Web and contracts TypeScript checks passed.
- Web lint passed.
- Isolated real API/database/browser flow: create from template, publish, submit one response, generate formal report with section interpretation, export Word and verify saved response count.

## Boundaries
Interpretation is deterministic descriptive analysis. It does not assert that higher scores are better without a configured semantic rule, invent maturity grades, or bypass small-group disclosure limits. Grouped and time-series blocks retain their existing charts without automatic narrative. Existing reports need regeneration. No deployment was performed by this change.
