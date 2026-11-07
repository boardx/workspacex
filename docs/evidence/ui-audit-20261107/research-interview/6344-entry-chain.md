# #6344 / #6369 follow-up: retain project at list create entry

Base: `50fb47deb326aa16c40391ce3da9b07527498108`. The parent reproduced the failure in real local Chrome against real PG: project -> research list -> New research navigated to `/research/new` without `projectId`. Existing new-page association logic only works after receiving the query, so the earlier PR did not cover the entry link.

`ResearchHome` did not receive its parent's projectId. The top action, empty-state action and populated-list create card all had literal `/research/new` hrefs. The minimal fix passes the existing projectId into ResearchHome and uses the existing withProjectId helper for all three anchors. The standalone href stays `/research/new`.

History detail uses the existing onNavigate callback, which already preserves projectId; the new click test checks it without changing that path. The project's return alias is known to map correctly in GeneralProject and is unchanged.

Regression: four component-level click cases cover both top/secondary new links with empty/populated history. They follow the actual rendered anchor URL, instantiate the new route using that URL, verify the association callback and study URL, invoke the study return, then click the existing project breadcrumb. ResearchIntake is a controlled callback fixture; the browser's default anchor navigation is simulated from the actual href because jsdom cannot navigate. This is a link/route/association orchestration check, not a fresh browser or DB creation success claim. Parent handles real Chrome recheck.

RED: four entry-chain cases fail because projectId is absent; existing history navigation passes. GREEN also checks standalone link behavior and existing GuidedResearchFlow tests.

```sh
WORKSPACEX_WEB_TEST_MAX_WORKERS=1 pnpm --filter web exec vitest run tests/ui/research-project-entry-chain.test.tsx tests/ui/guided-research-flow.test.tsx
```

No source, branch, worktree, running Next server or API was changed in the shared checkout by this worker. All changes were made in `/tmp/research-project-entry-6344`.
