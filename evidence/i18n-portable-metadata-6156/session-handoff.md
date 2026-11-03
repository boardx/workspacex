# #6156 snapshot

## Verified
Initial source: `e205ab69d4e35b7e165526dfd374501ff4ecc3e6`; guard followup source: `3a0f15a7afb9ec56280c954423fbdd7af7edd66a`. Selected tests and production browser pass; see README.md, browser-green.txt, pg-http-tests.txt and init.txt. These files were confirmed in `git ls-tree HEAD` before this handoff was written. Exact source review found no actionable P1/P2; reviewer did not independently rerun tests. Live Docker inventory has no containers for any of this scope's three isolated runs.

## Changes and decisions
Display metadata version2 derives authored names from requirements and pins current compatible official dependencies. Old v1 envelopes and official offer DTO remain compatible. Imports bind verified bytes, source snapshots and actual inserted IDs; metadata refresh preserves immutable execution and manual edits/clears. Exports fail closed on unavailable pins. Existing organizations must explicitly click the administrator update; new scoped installs use the independent metadata offer. Exact Next proxy routes are included.

## Pending and limits
First normal pre-push stopped on permission lint; the standard guarded-read wiring was added and full API lint plus PG/HTTP21 passed again. Retry of normal pre-push and remote PR CI remain pending at this snapshot. `guard-pg-http-green.txt` and `api-lint-green.txt` were confirmed in the followup commit tree. #6161 UI source is an ancestor; it must merge before this scope. All merges are by the main coordinator after latest-head checks/ruleset review. No production deployment or image-build verification is claimed. Exported original file bytes/per-file digests are preserved; JSONB-normalized manifests receive a new portable envelope, and cross-organization Agent pin resolution remains fail-closed.

## Next action
In this existing worktree, run normal `git push -u origin worker/i18n-portable-metadata-6156` after the shared heavy window is free. Create the develop PR with `Closes #6156`; follow its latest-head CI and reviews through green. Have the main coordinator merge only after #6161. Keep using this worktree during fixes; do not create a second worktree or apply any stash by index. The retained stash `981114a516b9b50e84ce668907d55c8fc7f511a7` is now superseded by the committed source and is only a backup.
