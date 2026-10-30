# Release history reconciliation (#6031)

The user requested preserving all develop changes first, then synchronizing develop into main/main-us. Original remote tips are retained in baseline.json and remote branches backup/20261030-pre-sync-{develop,main,main-us}.

Merge main and main-us into a branch based on develop using normal merge commits. The only conflict was subscription explanatory text in live-subscription.tsx: retain develop's monthly 20,000-credit behavior. Before adding these evidence files, the resulting tree differed from original develop only in two image-sync verification files, both identical to original main. All three original tips passed merge-base --is-ancestor against the reconciliation head.

API provider tests: 10 passed. UI verification and PR CI results are recorded on #6031. No feature status changed. No force push, reset, squash or rebase of existing branch history. Production host activation and database migration are separate from Git branch synchronization.

Release PR #6034 review found a pre-existing self-usage cursor defect in develop: adding returned asOf changes parsed object property order, so equivalent pagination scope hashes differ. A service-level test reproduced FORBIDDEN before the fix (cursor-red.md). Sort non-cursor query fields before hashing; both continuation and cross-filter/snapshot/user/membership rejection tests pass (cursor-green.md). This correction must merge into develop before release PRs continue. Principal and verified membership checks are unchanged.
