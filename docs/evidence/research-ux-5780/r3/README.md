# Research UX R3 — failed-save draft recovery (#5787)

New path: controlled HTTP503 delivery failure → actual API/PG recovery read → choose retained draft → user retries save → real API/PG acknowledgement → normal reload. A second controlled failure then exercises cancellation to acknowledged data. This is injected transport failure in owned synthetic data, not an upstream/provider failure or research-quality claim.

Before: retained content visible but Save disappeared (saveCount0); server still original title/version1, model/agent counts0. before/ records the real failing path. The new isolated retained-value unit also failed before the change.

Fix: PlanEditor receives persistedValue from the existing authoritative state.outline (defaults to value for compatibility); displayed local value is not an acknowledgement. Dirty/cancel uses that baseline; cancel synchronizes the parent local draft. No copy of server state is stored and no API/state-machine contract changes. Semantic comparison keeps edits when acknowledged data arrives as new objects.

After: saveCount1 after retention; explicit retry persists title/version2 and survives refresh; a second failed save followed by Cancel returns to that same acknowledgement without another API write. Errors clear when clean, successful save clears dirty, unchanged acknowledged input is preserved. before/ and after/ include actual screenshots/JSON. Runs/model starts remain0, no generation/export request submitted.

Verification:8 targeted UI tests (5 editor +3 checkpoint tests), TypeScript/focused lint. Same reserved API/PG/Next dev renderer ran R3 and then the distinct R4 audit sequentially: R3 passed; R4 found a separate long-title overflow and is not counted here as passing. Whole stack exited/cleaned after45s, without holding a source-edit barrier or another production build.
