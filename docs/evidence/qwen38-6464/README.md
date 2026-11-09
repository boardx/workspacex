# #6464 — Database-selected conversation model

User-approved behavior: all ordinary conversation digital humans inherit the organization's database core-model selection for new tasks. Initial requested runtime model is `qwen3.8-max`; a later admin change applies to new tasks without reimporting roles. Image generation and deep research retain their specialized model protocols.

Implementation:
- Existing organization_core_models selection and immutable agent_run_core_model_snapshots are reused. Both provider and runtime model are accepted atomically; deep-agent remains an execution runtime and forwards the selected model explicitly.
- Replay returns before reading the current preference. Agent versions and historical run bindings are not rewritten. Existing unconfigured organizations retain their database-authored version binding until an administrator selects a core model; no new compatibility fallback or credential/account is introduced.
- Official roles 1.8.0 and Python initial defaults use qwen3.8-max. Removed the exact retired qwen-plus catalogue entry; distinct character models and historical evidence remain intact.
- Admin setting copy describes the expanded scope in Chinese and English.

Verification:
- RED: 3 new core-routing assertions failed before implementation (14 existing assertions passed).
- API core snapshot/runtime guard: 3 files / 34 tests passed.
- PostgreSQL selection/CAS/RLS/audit, actual acceptance/replay and chat/capability regressions: 4 files / 44 tests passed. Switching DB preference preserves first run selection_version=1 and selects version=2 for another digital human.
- Real HTTP loopback deep-agent forwarding and title admission: 2 files / 24 tests passed. Captured configurable.model_id=qwen3.8-max.
- Earlier shared cleanup: related API/PG 20 files /195 tests; Python model/pinning/usage/golden 36 tests; full contracts 146 files /1489 tests passed.
- Web model-catalog localization: 1 file /26 tests passed.
- API and Web typecheck/lint, ./init.sh and git diff --check passed.
- Independent static review reports no concrete P1/P2 findings; it does not prove paid-provider/private-connection execution in CN.

Local logs: /tmp/qwen38-core-red.log, /tmp/qwen38-core-unit.log, /tmp/qwen38-core-pg.log, /tmp/qwen38-dispatch.log, /tmp/qwen38-web-core.log, /tmp/qwen38-pg-final.log, /tmp/qwen38-python-regression.log, /tmp/qwen38-contracts.log, /tmp/qwen38-typecheck-final.log, /tmp/qwen38-lint-final.log, /tmp/qwen38-web-lint.log, /tmp/qwen38-init.log.

Deployment boundary: no CN config mutation, production DB write, paid provider call or deployment performed. Production activation requires an available, verified qwen3.8-max model-pool binding and an admin core selection. Credentials stay in protected provider configuration; no account was created. Source cleanup alone does not establish provider readiness.

PR review correction: historical-role upgrade eligibility originally compared the old model to the new target. RED with the actual qwen-plus 1.5 fixture:2 failed/3 passed. Fixed only the provenance-checked upgrade boundary, recognizes frozen 1.7 instruction identities and preserves verified existing pins; custom source models remain rejected. Final real PostgreSQL/HTTP + authorship + upgrade suites:3 files/16 passed. API typecheck/lint repeated successfully. Independent diff review: no P1/P2. No retired-model runtime fallback introduced.
