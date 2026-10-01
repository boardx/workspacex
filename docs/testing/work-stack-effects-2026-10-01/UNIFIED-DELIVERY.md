# Unified Work Stack repair delivery

The user requested one PR for the complete Work Stack testing/fix effort. PR #4867 is the sole delivery target; #4866, #4872, #4875, #4876 and #4879 are superseded. Issue references and historical test evidence are retained. The latest main revision (39f158964) is included.

## Final behavior

- Workflow Skill stages load the organization's pinned, published SKILL.md before model execution; missing instructions fail before the model call.
- Admin users can discover and explicitly enable official digital humans with their dependencies. Admin and both chat picker entry paths bind multi-request imports to the initiating organization/session; context changes cancel remaining requests and suppress stale results. Server endpoints reject mismatched expectedOrgId before dependencies are accessed.
- Pinned role instructions define Agent identity across memory retrieval and legacy Python execution.
- PDF failures retain bounded internal reasons, including missing native runtime. External failures stay generic; document content, credentials and execution identifiers are excluded from diagnostic logs.
- Deployment readiness probes the public anonymous WebSocket Upgrade and accepts only the gateway's 401 refusal. This checks routing/authentication refusal, not supplier/audio readiness.
- S003 validates actual eval output against generated strict authored schemas. work-research 1.0.1 is generated; historical 1.0.0 and official-role pins are preserved.

## Consolidation and continued fixes

All 40 production/test/package files from the five source branches were byte-compared after initial consolidation: zero differences. Shared module experience entries were combined. Continued development added chat import scope and the PDF runtime-unavailable classification.

Counterexamples: the previous chat hook failed six real-helper/component scope cases; the production PDF factory/controller failed both missing-runtime cases. Both were fixed and tested.

## Combined verification

- API: 13 files, 122 tests passed against an isolated real PostgreSQL/AGE/pgvector stack (`unified-api.log`), including W029 production DI/HTTP and fixed-version tenant isolation. The stack was cleaned by the isolation wrapper.
- PDF production composition/service/controller: 15 tests passed (`unified-pdf-runtime.log`).
- Admin/directory/home/helper UI: 82 tests passed (`unified-web.log`). Chat scope/helper: 15 passed; existing capability/model tests: 31 passed (`unified-chat-scope.log`, `unified-chat-existing.log`). The seven helper cases overlap the admin batch; counts describe runs, not unique cases.
- Public voice deployment gate/trusted-copy/route repair: 38 passed (`unified-voice.log`).
- Python role/model-request/graph: 12 passed (`unified-python.log`).
- Normal pre-push typecheck/lint passed for unified head 5cd5d96ab (all 20 affected tasks succeeded). Latest unified-head CI is authoritative; further fixes require a new normal check.

Two earlier API attempts are retained honestly. The first loaded the main checkout's old contracts through shared node_modules and returned 400 instead of 403 in two tests. Local workspace links were corrected. The second overlapped a source update, mixing cached code and a new assertion. The stable final API run passed all 122 tests; neither failed attempt is counted as green.

## Remaining backlog

Latest-head CI, deployment SHA, authenticated browser role/PDF/audio acceptance and tester report remain open. This cloud session cannot send to the testing session or access its local inbox, and has no live model credentials; no test was dispatched. C01/C02/C03 broader authored-entity/schema/real-model coverage remains open. Local passing tests do not establish that devapp is repaired.

The five superseded PRs were closed after verifying GitHub PR #4867 contained unified head 5cd5d96abb012331a4e27f458ebb7906d913f4e1. The one remaining review entry is #4867. Continued eval-evidence and extraction timing fixes are tracked in BACKLOG.md.

## Continued evidence and CI repairs

Evaluation reports now bind suite, fixture and grader identity; historical or stale reports cannot pass current gates. The runner refuses changed cached graders and mid-run input mutation. Extraction feedback waits for a saved thread. See EVAL-EVIDENCE-TRUST.md and extraction regression evidence.

S003 Zod definitions now live in contracts; the integrated single-source/schema checks passed 11/11. The permission whitelist budget admits precisely the guarded pinned reader. The real-pack regression imports the builder current version, retains old-pack mismatch counterproof, and passed 2/2 in isolated real PG/HTTP. An earlier combined run passed 131/132; its single old-pack fixture failure is retained.

Old published head fullstack smoke failed because upstream GitHub API quota was exhausted (403, remaining=0). This is not counted passing; latest-head CI remains required.

Integrated continued-fix verification: 12 files / 134 tests passed against isolated real PG, including all work-eval tests, permission counterproofs and pinned Skill loopback. Cleanup completed. See unified-final-eval-db.log. Extraction regression 7 + 32 passed (unified-extraction*.log).

Normal continued-fix push at 8456b5a92 passed all 20 affected typecheck/lint tasks (5 cached) and reached GitHub. Evidence-log trailing whitespace was normalized only; raw /tmp captures are retained. Latest CI remains pending.
