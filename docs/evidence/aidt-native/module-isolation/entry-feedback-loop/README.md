# AIDT entry feedback iteration — 2026-11-15

## Three issues examined

1. The native project list merges actual member projects and organization-managed projects. Its lifecycle readOnlyReason does not identify membership; the generic overview also permits a read-only organization-manager fallback. Treating that list/overview as proof of membership led administrators into an unrelated AIDT workspace that then failed its actual shared-stage API. A module-local adapter now reads the existing `GET /projects/:projectId/collaborators` contract using the captured bearer and abort signal. The home includes only projects whose actual roster contains this actor; the workspace independently checks the same roster before mounting teaching content. Native server authorization remains authoritative. Failures remain explicit and retryable; an inaccessible roster is not an empty group list. Home roster reads run in batches of at most four per identity/retry and do not run on unrelated renders. Default-off direct components make no requests.
2. Creation guarded only by equality of the current identity string. A user switching A→B→A could cause an old A create result to look current again and continue tag writes/navigation. An actor lifecycle generation now invalidates old callbacks even if the same identity returns. The ordinary generic CreateProjectForm is unchanged. An open roster now mounts its existing native panel on demand rather than loading the project and organization rosters while collapsed.
3. Dashboard still described all content as a page-only draft that resets on refresh, although real shared revisions and re-entry restoration now exist. Dashboard accepts the existing shared-stage controller projection and displays real revision receipts separately from local edits. Loading/error never becomes “not saved”; retry calls the real existing reload. Saving does not imply completion or group consensus. Dashboard now has one H1 for keyboard/screen-reader orientation. The original layout/styles stayed unchanged until the fresh QA screenshot review. After viewing the fresh baseline images at `/workspace/scratch/aidt-feedback-loop/baseline/01-dashboard-1280.png` and `01-dashboard-375.png`, the mobile view showed only about two steps because the cards were oversized. Repeated educational copy and identical six entry labels also weakened the starting point. Root approved a compact revision: six mobile rows, native desktop 3×2 cards with badge/title in one row, a single short teaching principle, and an explicit first-step primary link only after a genuinely empty shared-stage read. The existing native Button is reused. This does not infer a current/completed stage. Final screenshots must come from QA's rebuilt final candidate; the baseline screenshots are not presented as after images.

## Final local candidate

The compact responsive Dashboard, real-membership entry and creation lifecycle changes passed a combined 62/62 tests at 2026-11-15 01:59:46 UTC, duration 14.95s. Targeted web ESLint and git diff --check exited 0. Source is frozen for QA's rebuilt final candidate; fresh final screenshots remain a separate browser verification step.

```
PATH=/tmp/aidt-node/node_modules/node/bin:/tmp/aidt-ui-v3-bin:$PATH WORKSPACEX_WEB_TEST_MAX_WORKERS=1 pnpm --filter web test tests/aidt-project-membership.test.ts tests/ui/aidt-entry.test.tsx tests/ui/aidt-resource-isolation.test.tsx tests/ui/aidt-entry-isolation.test.tsx tests/ui/aidt-ui-v3.test.tsx tests/ui/project-aidt.test.tsx
```

## Verification boundaries

- 42/42 entry/membership/create/cancellation tests passed at 01:49:16 UTC, duration 11.19s.
- 19/19 dashboard/native workspace compatibility tests passed at 01:53:12 UTC, duration 8.96s.
- These are local mocked service/UI tests. The membership adapter test exercises the real contract validation and captured-token request construction with a mocked apiRequest; it is not live membership/PG acceptance.
- The 42 tests include actual-roster filtering versus management-only listing; dependency 403 is an error with retry; default-off guards; bounded fetching; actor A→B→A response isolation; archived member workspaces remain read-only; and lazy mounting of the native member roster.
- The dashboard tests cover real server revision/local edit labels and failure handling, while preserving native Chat/recording routing tests.
- Targeted web ESLint completed with exit 0; git diff --check passed.
- Parent/QA owns real server and browser screenshots for this iteration. No score, fresh screenshot result, deployment, signoff status, or successful PR is invented here.
