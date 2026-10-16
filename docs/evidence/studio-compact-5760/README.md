# Shared compact workflow evidence — #5760

Actual React component preview, synthetic content, captured at 375/768/1280 CSS pixels. Imports production WorkflowActionButton/Bar; no model or business API calls. Direct and nested asChild primary actions are measured. Screenshots and shared-metrics.json record the same browser run.

375: secondary minimum 96px, primary fills its own row. 768/1280: primary natural width, minimum 112px. All actions 36px tall; no horizontal overflow. Long report content retains its card boundary after removal of the redundant footer separator.

Verification: 31 related UI tests, web TypeScript and focused lint passed before main integration; rerun results are recorded in the PR. This is component presentation evidence, not end-to-end report generation or deployed-environment evidence.

The neutral studio/workflow entry reexports the existing implementation. Workspace styles opt in to the existing spacing scale; no global Button defaults or business contracts change.
