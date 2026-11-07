# Interview expert presentation and report dependency repair (#6330)

User request: remove the selected-expert avatar draft notice; show expert names and roles without generated IDs/disclaimers in transcript headers; repair report generation failure.

## Root cause and changes

- The selected compact avatar editor rendered its disabledReason next to the expert name. This call site no longer supplies the notice; the unsaved avatar remains disabled. The selected list's internal stable-ID explanation is removed.
- The read-only transcript projection missed the generated `name（persona-id）访谈回复/回答` heading and italic leading notice. It now recognizes these formats while preserving answer text, code examples, stable anchors, and canonical Markdown. Names/roles are projected from saved expert fields, not generated answer identity claims.
- The actual report DI path is `generateProfessionalInterviewReport`. CN returned two `context` events then `failed/AI_GENERATION_UNAVAILABLE` before any model attempt or saved report. A read-only command inside the live API container confirmed `configuredRoot:false`, `shippedPacks:false`, and `REPORT_SKILL_LOAD_FAILED`. The API image copied localizations but omitted starter packs and their configured production root. The Dockerfile now ships the manifests, explicitly sets their root, and verifies the report skill with the real manifest/file digest loader during image construction.
- The report page now offers generation after reload when answers are complete and no report exists. The previous retry condition depended on transient component error state, losing the action on refresh.

## Validation

- RED: screenshot-style headings/notices and selected avatar notice: 4 failures, 73 passes before the fix.
- RED: reload with completed answers and no report: 1 failure, 26 passes before the fix.
- RED: saved expert role projection: 2 failures before implementation. Embedded selected-expert title: 1 failure before display-only normalization.
- `pnpm --filter web exec vitest run tests/ui/interview-source-runs.test.tsx tests/ui/interview-markdown-editing.test.tsx tests/ui/interview-markdown-execution.test.tsx tests/lib/interview-report-stream.test.ts`: 110 passed.
- `pnpm --filter @repo/api exec vitest run --config vitest.interview-markdown-unit.config.ts`: 464 passed.
- Production-mode real loader smoke: unconfigured root rejects before model; configured repository starter-pack directory loads the verified report skill (1266 characters). No model or provider fixtures replace this file-loading check.
- `./init.sh`: quick initialization passed.
- Web/API typecheck and lint: exit 0; `git diff --check`: exit 0. The required push checks revalidate the final commit.

## Boundaries and handoff

No production container/configuration was changed or restarted. Existing interview source documents and saved answers were not edited; no report was saved by the failing requests. Browser interception used only for diagnostics was cleared. No new worktree or Docker stack was created.

The full image build and a real-model/browser report acceptance must run after the authorized merge/release. Local file-loading and controlled protocol tests do not claim production recovery. No private interview text, credentials, raw provider errors, or user screenshots are published here.
