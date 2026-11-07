# Branch synchronization completion contract

1. Merge the reconciliation PR into develop with a merge commit after required checks pass; retain exact source review.
2. Create release PRs directly from develop into main and main-us. Use merge commits to preserve develop ancestry.
3. Fetch all three remote branches and assert each baseline.json SHA is an ancestor of develop.
4. Assert the promoted develop SHA is an ancestor of main and main-us, and git diff --exit-code between the promoted develop tree and each production branch.
5. Record final remote SHAs, PRs and checks on #6031. If develop moves concurrently, reconcile the new tip before declaring current branch synchronization complete.

Do not dispatch production activation or migration as part of this Git synchronization. Develop pushes may trigger the existing automatic devapp release lane; inspect its result separately.
