# DevApp PDF failure — 2026-10-01

Root cause verified from live runner evidence [36845699068](https://github.com/boardx/workspacex/actions/runs/36845699068). Deployed repository SHA was eed7bfd9632b0f0b3d099c640bded9fb6cef8f75. Three failed native-v1/qwen-plus runs called unregistered document-understanding with mode/limit/file_path. Kernel raised ToolAuthorityError: Tool is outside the persisted native snapshot. There is no evidence a PDF parser or script started.

Fix: after validating the graph's real registry against the persisted snapshot, unknown tool names receive an error ToolMessage before authorization/sandbox dispatch. The model can read SKILL.md and call wx_document_parse with the documented schema. Known tools outside the snapshot and authority failures retain their existing terminal refusal. No permission expansion, timeout change, parser retry, or fabricated plan completion.

Regression: synchronous and asynchronous real compiled graph, invented skill-name tool, no authority dispatch for that call, corrected wx_document_parse dispatched and returned, final response reached. Existing registered execute/read_file outside-snapshot negatives remain. Pre-fix new regression: 2 failures with the exact live exception. Post-fix targeted Python tests and document tests recorded in PR.

Initial probe hit Git ownership mismatch; per-command safe.directory corrected the read-only lookup. The temporary fixed-thread workflow input was restored before final PR; private raw logs stay outside git and artifact retention is 3 days, explicitly approved by user.

Not yet claimed: CI green, merge, deployment, or live PDF plan completion. These require later evidence. Shared checkout was preserved; work is isolated in /private/tmp/workspacex-pdf-4869. No owned Docker stack started.
