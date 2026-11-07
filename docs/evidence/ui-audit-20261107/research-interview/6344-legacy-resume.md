# Project research legacy-link recovery

The project resource links to /research?session=…&projectId=…. The legacy page previously forced brief when flow was absent, even when the authorized runtime had reached research and failed with RESEARCH_SOURCES_REQUIRED. The step navigation showed stage 3 while the main area displayed the first-step editor and hid the current failure. This was reproduced through CUA and independently traced without relying on cached browsing state.

The default flow now uses the existing resolver home behavior; GuidedResearchFlow already passes no initial node for session+home and restores the authorized runtime currentNode. Explicit flow/stage/history browsing, screen selection, dirty guards, runtime and resource permissions are unchanged. The fix does not infer progress from legacy session.stage or redirect every session to report.

- Before: three fresh-routing failures (research failure, plan, report).
- Author and root: 56/56 existing flow/production-route tests passed. Independent targeted review: 8 selected recovery cases passed, 21 explicitly unselected. Actual renderer and runtime-state recovery are used; no autoexecute is expected.
- Author page dependency-closure typecheck passed; full pre-push and head CI remain required.
- Root CUA after integration: the same legacy URL resolves to the same study canonical report with projectId, exposing the retained materials gap and failed timeline. Root then clicked Return to project and the actual grs_1f7d5a6fe76b416498624f9edb0701d0 project resource card; it again restored report and the persisted error, without generating another report or creating a replacement study.

[Legacy link restores actual runtime](6344-ui/28-research-project-resume-fixed.png)

[Actual project card click restores the same failure step](6344-ui/29-research-project-card-click-restored.png)

This is navigation/recovery evidence on an isolated real API/PostgreSQL application with explicitly controlled model upstreams. It is not a successful formal report, live-model quality check or production deployment. The separate materials-mode terminal label change belongs to PR 6372.
