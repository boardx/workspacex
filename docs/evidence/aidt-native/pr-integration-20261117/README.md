# AIDT native module — develop integration / PR evidence

This ad-hoc PR carries the requested isolated native teaching module, V2 six-stage inputs/outputs and report, shared saved revisions, course-to-existing-project mapping, native Chat context bridge and global member text plugin. Student decisions stay separate from generated feedback. It reuses the WorkspaceX Chat composer, research attachments, Design Workbench and export tools. Real interview recording/ASR and voice rooms remain explicitly deferred by the user.

## Source and scope

- Feature delivery source: `00480eff10` on `worker/aidt-completion-20261116`, preserved unchanged.
- Integrated develop: `4060bcf2017ef5775b762f2135f22042f8a96d19`.
- Integration merge: `1a2ec212d38635a60b1337cc4a949ec564c0d7a8`; final validation incorporates the subsequent explicit fixes described below. Tests on a dirty worktree are identified as such, with recorded source hashes.
- Branch: `worker/aidt-native-pr-20261117`. Original worktrees and their six untracked screenshots were not modified or published.
- Most changed files are historical test/evidence and immutable Skill versions, not new unrelated features. The publication audit covers historical blobs as well as current files.
- Refs #5649 only as six-stage teaching-framework background; that closed marketing task is not this native implementation's tracking issue and is not closed/reopened by this PR. Creating a new issue was rejected by automatic approval review; it was not retried through another tool.

## New integration fixes

1. Bound saved/source/history revisions to PostgreSQL integer, and preserve one increment for save expectedRevision. Ten counterexamples fail before the fix and pass afterward.
2. Rename the new member-chat schema export to `MemberChatReadOnlyReason`, avoiding the existing lifecycle type without changing wire values or relaxing contract-source lint.
3. Register seven teaching Skill slugs as hidden module-hosted capabilities; preserve ordinary three entry points, historical pinned bytes and candidate scanning.
4. Add explicit default-off DevApp-only Web release build opt-in; API runtime enablement, schema release and native host admission remain separate. Known AIDT tags use a reserved numeric attempt prefix compatible with installed consumers; source CI blocks their CN/US reuse even when enable=false. Registry 34 tests, branch policy 9 and alias checks 5 pass. This is a CI-entry guard, not signed flavor evidence or protection against external/manual legacy retagging. See release-optin.md and independent-source-review.md.

## Fresh integration validation

| Check | Actual local outcome | Evidence |
| --- | --- | --- |
| init quick | exit 0 | `aidt-pr-init-20261117.log` |
| Complete contracts | 147 files / 1504 passed | `contracts-verification.md` and final log |
| AIDT Web | 96 files / 818 passed | `web-verification.md`, `web-results.json` |
| Shared Web / ordinary Chat / member text / export | 21 files / 192 passed | same |
| Affected stage consumers after revision fix | 7 files / 67 passed, overlaps 818 | same |
| Seven no-DB/no-model API suites | 45 files / 625 passed | `api-verification.md`, `api-results.json` |
| Python original matrix | 241 passed / 2 skipped | `python-verification.md`, final log |
| contracts/Web/API nonincremental typing | exit 0 at recorded source states | individual receipts; final name-change checks added separately |
| Contract-source, shipped-pack, metadata, skills-doctor | exit 0 | contracts / Skill receipts |

Counts in overlapping reruns must not be added as unique tests. Python's two E003 official sandbox checks remain skipped, not green. The adjacent deploy-registry missing-policy test has an existing container environment error: current `/` uid 65534 fails the root-owned path trust check before the expected missing-file check. The same failure was reproduced using original develop consumer; no trust gate or test expectation was weakened.

The complete contracts' initial two red Skill registrations and original type-name lint failure remain in separate logs. The final fixes were verified; failure history was not overwritten. None of these local unit/component checks is remote CI, a DevApp deployment, or a real classroom trial.

## Earlier end-to-end evidence and limits

Historical browser, real PostgreSQL and paid model evidence is retained under the existing `completion-20261116`, `completion-20261117`, `real-browser-acceptance-20261117` and `remediation-20261117` directories. The model run / student correction / canonical import / fresh login / report export chain is documented there. All teaching material is synthetic; no actual interview, learning effectiveness or teacher acceptance is claimed. Those earlier runs were on their recorded feature source, not falsely relabeled as this integration merge. No new paid model or browser test was run for the integration fixes.

## Release prerequisites — merge is not deployment

The user now explicitly authorizes PR submission and merge into **develop**, and wants to test **devapp.boardx.us**. Production deployment and permission changes remain prohibited. Never use automatic push-to-production, manual SSH/SQL or host-policy bypass.

Five migrations are required before this API can run against an old schema, **even with AIDT disabled**, because ordinary Chat reads/writes `agent_runs.aidt_selector_hash`:

- `20261115092900_aidt_stage_revisions.sql`
- `20261115093000_project_member_chat.sql`
- `20261116093000_aidt_courses.sql`
- `20261116140000_aidt_raw_upload_runs.sql`
- `20261116160000_aidt_run_context.sql`

These require the existing separately reviewed schema release route; merging source is not a migration/privilege approval. The existing release consumer must retain its schema inventory/admission checks and exact source/image bindings. Actual DevApp schema adapter and runtime configuration have not yet been verified. New Web compilation flags alone do not enable the API. API `ENABLE_AIDT_MODULE=1` and `ENABLE_PROJECT_MEMBER_CHAT=1` must use existing reviewed host configuration. No host config, app_rw grants, roles, root wrapper or policy has been changed here.

The manual `image-release` workflow, exact merged source, all-five-images manifest, native schema admission, running artifact and actual `/aidt` UI must be verified separately before calling DevApp available. Public ordinary-site HTTP response alone is not AIDT acceptance. PR/CI/release receipts will be posted on the PR rather than self-marking any feature passing or human signoff approved.

## Strict CI preflight corrections

The OSS scanner originally rejected three newly introduced synthetic secret literals in tests. Only those fixture values were labeled with the existing accepted dummy prefix; the redaction assertions still check full values, and the scanner/baseline were not changed. Diagnostics Python passed 12 tests plus 6 subtests, local CLI passed 10, and real loopback TLS/canned SDK transport passed 2 (zero provider calls). Final strict scan has zero baseline-external matches. Original failure output is retained alongside green output.

Route coverage correctly found two stale allowlist entries for newly implemented `files:getIngestionRun` and `files:uploadArtifact`. Only these entries were removed: strict gate exit 0, 247/247 remaining entries still missing, four existing gate/ratchet suites 72/72 pass. No exception or strictness was expanded. See route-ratchet-verification.md.

The pure current lightweight CI selector locally selects five contract files (37 passing tests), and reports the broad feature impact as deferred. This is not full regression; the broader fresh integration suites above are separate evidence. Arch-dependencies (2314 files), edition-capability and lightweight graph checks pass.

The two display log copies for route tests and CLI tests omit redundant final blank lines; original process logs remain intact at their recorded local paths.
