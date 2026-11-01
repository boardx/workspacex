# #6079 verification and handoff

Baseline: origin/develop e44119db91e9539418ad605ca6aaef2c155d0116.
Worktree reused: 23d9/workspacex. Branch: worker/tag-schema-release.

## Plan / progress

- Reviewed live CN/US failure logs and existing image-only/schema guards.
- Implemented API-first actual inventory comparison and bounded public diagnostics.
- Added opt-in full-release adapter protocol; requires independently installed,
  pinned root writer/verifier and real original backup/restore/compatibility proofs.
- No full production writer was supplied or installed. `schemaRelease` must stay
  absent on CN and US. Issue #6079 remains open for environment qualification.
- No SQL, host policy, permissions, credentials, runtime or public traffic changed.

## Executed tests

- New schema-plan suite first failed for missing implementation, then passed.
- New adapter protocol suite first failed for missing implementation, then passed.
- API-first no-unrelated-pull expectation first failed (API+Agent pulled), then
  passed after staging API ahead of Agent. Consumer test covers actual child
  `create/cp/rm` probe commands and confirms all probes cleaned and zero switches.
- Invalid service mapping negative test first failed, then passed after enforcing
  application-only services on the full route. Traversal proof reference first
  failed, then passed after rejecting parent traversal/canonicalizing proof paths.
- Consumer tests include real writer/verifier child processes with clearly
  `fixtureOnly` proof data; nonzero writer exit even after writing a receipt and
  subsequent runtime failure both retain pending intent and block next dispatch.
- Existing registry suites passed (48 tests at the intermediate revision).
- Existing CI image-release gate passed (3 tests at the intermediate revision).
- Final test counts/CI are recorded on the PR; those supersede intermediate counts.

These are protocol/offline tests, not a live restored database, schema migration,
root installation, real Docker behavior, or public-browser release acceptance.

Independent review found no Critical/Important findings in the reviewed draft,
and explicitly required the production adapter remain unconfigured until actual
qualification. Subsequent author hardening added application service exclusion,
original-pointer retention, request identity checks and proof-path traversal checks;
final SHA review and CI status are tracked on the PR.

## Outstanding handoff

See docs/operations/tag-schema-release.md. Environment-specific writer/verifier
code, actual isolated restore and compatibility evidence, safe once-only migration,
recovery rehearsal and reviewed installed root closure remain prerequisites before
using automatic schema promotion. CN's existing TOC inspection is explicitly not
restore acceptance; US's full schema driver was not verified. Do not bypass the
old image-only schema guard or close this gap using today's branch green.
