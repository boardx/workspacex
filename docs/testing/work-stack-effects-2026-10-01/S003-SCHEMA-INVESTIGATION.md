# S003 strict machine contract repair

S003's package previously pointed JSON Schema `$ref` at Markdown chapters. AJV correctly rejected those references. The loopback had drifted from authored requirement §5/§6: missing fields and unsupported `fact`, `draft-not-effective`, and `scope-not-configured` values. A 10/10 grader score therefore did not prove contract conformance.

## Change

- `apps/api/src/application/work-eval/s003-contract.ts` now defines strict input/output schemas from §5/§6. `generate-s003-machine-contract.ts` derives frontmatter JSON Schema; a regression test compares shipped schemas to that source.
- The subject loopback supplies declared scope and timestamps, question/type inference, claims, hit counts, read anchors, duplicate evidence and coverage/injection explanations; all output enums follow the authored contract. Draft evidence is `mentions-only` and never `supports`.
- `eval-runner.ts` validates actual subject output before grading. Malformed output cannot pass merely because the rule grader ignores a missing field. G2 now validates `date-time` rather than allowing AJV's default unknown-format behavior.
- E10 previously required an undeclared `items.researchPlanItemRef` output property. Its `itemsLinkedTo` grader now checks the legal `claimToVerify` string, which preserves the original factual question with its plan reference prefix (`RQ2: <question>`). No output field or enum was added to relax §6.
- Grader/policy and S003 Skill versions advanced to 1.0.1. The existing work-research builder produced `skills/starter-packs/work-research/1.0.1.json`; immutable 1.0.0 was preserved. Official role-pack dependency coordinates and existing fixed pins still reference 1.0.0, pending a reviewed role-pack migration.

## Evidence

- Six test files: 58 tests passed, `/tmp/eval-schema-tests.log`.
- Additional strict date-time counterproof and G0–G4 rerun: 26/26 passed, `/tmp/eval-schema-final-tests.log`. Conditional who-knows owner and final execution/pack tests: 29/29 passed, `/tmp/eval-schema-owner-tests.log`; additional owner counterproof 6/6 passed, `/tmp/eval-schema-owner-counterproof.log`. Generated JSON Schema and Zod both accept all actual subject outputs and reject missing who-knows owners: 6/6 passed, `/tmp/eval-schema-machine-counterproof.log`.
- Schema generator `--check` and pack builder `--check` passed.
- Actual harness-generated report `S003-20261001T061439-de5997.json`: subject 10/10, generic same-tools baseline 2/10, both deterministic loopbacks.
- S003 G0–G5 passed, `/tmp/eval-schema-gates-final.log`.
- API lint: exit 0, `/tmp/eval-schema-lint-final.log`; API typecheck rerun after linking workspace dependencies: exit 0, `/tmp/eval-schema-typecheck-complete.log`.

## Boundaries

These results establish deterministic schema/fixture conformance, not real-model quality or live retrieval behavior. Other 319 Work Stack entities were not repaired. Existing official role dependency versions were not silently migrated. No historical report or signed starter-pack JSON was manually altered.
