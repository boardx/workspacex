# API / Web source boundary

Web build: `b4bc0aba7663113c9c585064f7f6b8e5e9cdce73`. Reused API: `814dc05a36e1f2645b7528b9dacc0a344ec615ae`, port 24704. This is not a whole-application exact-b4bc deployment.

Read-only `git diff --name-only 814dc05a36e1f2645b7528b9dacc0a344ec615ae b4bc0aba7663113c9c585064f7f6b8e5e9cdce73 -- apps/api/src packages/contracts/src` returned only the following research/workflow files. Survey backend/contracts, kernel storage, auth/identity have no byte differences within those paths; #5193 product diff is Web-only.

```text
apps/api/src/application/research/guided-report-chapters.ts
apps/api/src/application/work-content/research-stage-content.ts
apps/api/src/application/work-content/research-to-brief.ts
apps/api/src/infrastructure/workflow/create-workflow-runtime.ts
apps/api/src/infrastructure/workflow/research-to-brief-graph.ts
packages/contracts/src/research-report-framing.ts
packages/contracts/src/research.ts
```
