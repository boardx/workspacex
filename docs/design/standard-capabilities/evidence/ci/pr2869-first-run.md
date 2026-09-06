# PR #2869 first-run diagnosis

The initial head was 749969d770d8b1beefed04a57e460ca90606fd6c. CI tests a synthetic merge checkout; its base is not necessarily this worktree baseline. Results below must not be projected onto a newer head.

- Backend run 34051440589: migrations failed forced replay; corrected in e4b8e9b34, local 202-migration empty-build/replay passed. CI reported 204 migrations.
- Backend shards: exact configuration keys omitted the newly required trusted memory scope; MCP fixture used the pre-schema fingerprint; a source-signature assertion and the two reviewed permission exceptions needed updates. Corrected in dd1079503; five-file targeted suite passed 73 tests.
- Two subtask tests entered failed, not completed. The synthetic merge changed the main-run stale threshold, exposing unintended coupling to the derived-subtask timeout policy. Dedicated subtask policy dd1079503 passed seven real-DB tests with a two-minute main-run threshold counterexample; new-head CI remains separate.
- Fullstack run 34051440564, job 101535673156: 73 passed, 4 failed, 1 skipped. The two initial GitHub-directory imports returned HTTP 422; downstream cases could not find the absent skill.

The downloaded Playwright network traces confirm all four import attempts (including retries) returned reasonCode IMPORT_FETCH_FAILED. The fetcher raises this exact reason only for a non-200 upstream HTTP response. It does not prove a specific status, rate limiting or an upstream outage. Server-side cause is not present in the uploaded runtime.log. Do not weaken import validation or substitute a mock response to make this live GitHub lane green.

Artifact: phase-01-fullstack-smoke-evidence-34051440564, id 9994798860. Local inspection extracts only the response status/reasonCode; traces themselves are not committed because they contain unrelated session traffic.

Links: https://github.com/boardx/workspacex/actions/runs/34051440589 and https://github.com/boardx/workspacex/actions/runs/34051440564 .
