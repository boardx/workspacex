# PR repair continuation — 2026-10-05

User deferred environment setup and requested resolving all PR problems. Repair `5b769417c5f019aa67c47fe5d1194d1c751d72c1` normally pushed after base `49c0c838d`: six toolbar failures fixed; shared-outbox suspension now waits outside native IDB transactions. Original targeted tests107/107 and affected regressions43/43 pass, typecheck/lint pass, normal pre-push20/20. Exact-head CI must finish independently. See [repair evidence](pr-repair/README.md).

Independent review found and fixed a diagnostic-only cleanup gap: browser acquisition is inside try, both owned browser and HTTP listener are separately cleaned, AggregateError preserves primary first. Re-run real Chromium diagnostic and lint exit0. No runtime/DB/role changes, merge or deployment. Formal product native suites remain NOT_RUN; original environment deficits still apply.

---

# Mac verification — 2026-10-05

Tested source: `f2363bd58acafda2d97f896295e1bec86f1e84bd`. Existing PR #5245 only. Both `114dcdc56` and `9fb4c32de` are ancestors. `5a301c` cannot be resolved in the Mac object database, including after fetching the existing PR branch.

- Initialization quick checks, Web typecheck and full lint passed.
- Diagnostic/runner/Sync export: 38 passed, zero skipped. Login capture/storage: 11 passed, zero skipped. File upload/response/primary failure: 21 passed, zero skipped.
- Complete Files suite collection: six tests, four files. Collection and pure tests do not establish browser/API/DB acceptance.
- Normal first push rejected because the remote advanced; both histories preserved by merge. Second normal push succeeded at testedHead. CI for that SHA triggered; no green claim.
- Merge retained browser-safe saved filename normalization and exact original metadata/bytes/hash/tile assertions, bounded Sync stages and first failure diagnostics.
- Real failed merged diagnostic run retained (32 passed, one failed): macOS temporary directory alias caused the source identity fixture to fail. Fixture now uses realpath; source symlink rejection remains.
- Existing Docker PostgreSQL actual version 16.15, vector 0.8.4. Formal native producer requires native PostgreSQL 16.15 and vector 0.8.6; required Mac tools not found at configured path or Applications/Homebrew. Existing databases were only queried; no seed, migration, reset, role alteration or replacement.
- Two isolated existing databases contain four same-tenant fullstack actors. No existing outsider credential found in these databases or kernel database; current exact-source Web/API and actual login/board roles not established.

**Product native acceptance NOT RUN; requiredSuiteComplete=false.** No tests deleted/skipped, no missing evidence treated as PASS. Main checkout and its existing staged/unstaged files untouched. No runtime, container or database created by this session.
