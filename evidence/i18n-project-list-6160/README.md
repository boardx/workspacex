# Project list and shared controls — #6160 / B2

Implementation reviewed at 4daf6d7d1e0f5b3b6babc007beb63335c3e77c51 against fd6debca22d0155b27c918692d0065055e84ddd3. Independent read-only review found no actionable issues. Work uses this session's existing worktree; latest main/develop fetched before the branch.

- red-summary.log: four English acceptance tests failed before implementation (selected failure/summary lines, original exit 1).
- unit-tests.log: 49 tests/seven files passed: project locale/original inputs+tags/payload/archive metadata, existing live list and create dialog, tag editor/primitives/utils, resource parity.
- shared-regressions.log: 51 further tests/four files passed: original wizard, modal/menu primitives, tag IME and card/tag single-source guards. 100 distinct tests total.
- copy-final.log: nine relevant tests rechecked after the trusted workshop rich-text template/search wording refinement; subset of the 100 above.
- secret-scan.log: post-commit scan, zero new hits. No scanner/baseline changes.
- browser-list.log: standard isolation wrapper selected exactly two tests in one new file, existing fullstack seeded project. No hidden parent project/dependency suite expansion.

Actual internationalization browser/API/DB acceptance passed 2/2 (3m58s command + 1s cleanup), using existing production fullstack config and standard isolation/cleanup wrapper, workers=1. CIRCLE_NODE_TOTAL=2 uses the installed Next config's cpus=max(1,total-1), limiting page workers to one. No timeout/assertion/production-mode weakening. The separate full createProject provenance contract still fails under known P3/#6163; this is not project-creation-wide compliance.

Raw project names/tags, current-org identity, request wire values, enum values, roles, callbacks, locks/timers, IME handling, normalization, focus and retry remain unchanged. Locale is render-time display input; no list effect depends on it. Stored raw failures retranslate fallback/known-create messages without repeating requests. Existing archive/tag unknown reason codes and raw error messages remain source fallback rather than regex translation. Legacy kind/status records retain default Chinese through canonical dictionary-backed helpers; project workspace consumers are a future slice.

Audit ledger marks partial routes and explicitly leaves previews/experimental/mock entry pages uncovered. Module knowledge was corrected from actual ProjectKind/listProjects schemas and PG creator-membership SQL, without changing those policies. Evidence is normalized only for line/trailing whitespace; red is explicitly a filtered summary.

## Independent full-contract baseline failure

See docs/design/i18n-project-list/known-p3-baseline.md and separate issue #6163. Fresh latest-develop real HTTP returned 201 id/kind/status and the unchanged full formal output parse failed for required provenanceEventId. The locale test's explicitly named, strictly derived local known-P3 compatibility path does not change the schema, fabricate events or declare full project creation compliant. Baseline source/config/SHA and red output retained separately; existing API contract-gap guards untouched. First UI run also had a test-helper late previous-page response body race, corrected by tracking a new refresh request after the current list loads.

## Final actual internationalization journey

browser.log: production build, lint/type validity and exactly two seeded tests passed. A real lead created general through the list modal; actual request payload preserved raw name/kind/blueprint/org. Fresh UI refresh requests and reload proved name and raw tag persistence; actual tag PATCH body matched the stable contract. Locale changes retained query/list view and did not fetch project data. Real archive/unarchive changed status and captions. A real consultant received 403 with localized role feedback and original draft retained, enabled retry and no created row after a fresh list read. Original full-contract P3 failure stays explicitly annotated, never relabeled compliant. No API response mocking in these journeys.

Three screenshots inspected: list at 375/1280 and denied modal at 375. Original Chinese/mixed names/tags remain intentionally visible. Project content and dialog fit; the global mobile header language select appears cropped at the viewport right edge in the 375 list capture (shared TopBar, outside this slice), reported to coordination for follow-up rather than called flawless. Button color may be captured during its existing CSS transition; real enabled state is asserted.

cleanup.log dynamically confirms all four owned run compose projects have zero running/stopped containers and their API/Web ports have no listener. Exact implementation reviewed at 4daf6d7d1; later scoped helper/P3 baseline/compatibility review at 3234ea8080bec5544ee8a5b8bff9925122b304c0 found no new actionable issues. Final normal mandatory pre-push gates passed 25/25 (23 cached), 12.607 seconds.

The initial mandatory push correctly blocked on four invalid RTL ByRole exact options in the new unit file. Those unsupported options were removed (string accessible names remain exact matches), four locale tests reran successfully and normal affected typecheck/lint then passed 25/25. Failure and final summaries retained; no hook bypass. Final post-commit secret scan remains zero new hits.

Further reference check found the old “admin cannot create” note also stale: canCreateProject permits lead or admin under #608. The actual rejected browser actor was a consultant; only the test title/documentation was clarified after the successful run, with no action/assertion/runtime change.
