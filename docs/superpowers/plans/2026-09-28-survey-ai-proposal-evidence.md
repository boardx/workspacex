# Survey AI Markdown proposals — issue #4451

## Scope and rulings

Continue in the existing survey worktree. Human merge only. Dependencies: collection controls PR #4475; no coordination gateway.

- Configured `ModelCallPort` returns a Markdown proposal. It does not mutate a survey, publish, or fabricate a fallback questionnaire.
- Text, authenticated member-uploaded transient bytes (MD/TXT/PDF/DOCX, 256 KiB), and owner-scoped saved transcription references are supported. File input does not claim persistent asset import or arbitrary object/URL access. PDF/DOCX use the existing conversion port.
- Recording reuses `/rec`; return to the survey and select a saved stopped recording by name. This is not an embedded recorder redesign. The picker currently displays the first returned page.
- Explicit application feeds the canonical design Markdown and existing save/version/conflict path. Existing tags absent from a proposal are added to that canonical source, not merely retained in React state.
- Generation is bounded to 60 seconds, validates the Markdown compiler result, and suppresses cancelled/stale UI results. Upstream cancellation after a browser disconnect is not claimed; provider work is bounded by the application timer.

## Verification observed

- Application/model/file tests: 7 passing; malformed output, unavailable provider, provider ignoring cancellation, disguised executable and conversion failure fail closed.
- Final isolated API rerun: 12 tests passed, including HTTP envelope sizing, authentication and owner-only saved transcription access. New proposal contract tests: 2 passed.
- Focused UI: 26 passing across AI proposal and live workspace files, including correction-before-apply, late cancellation, saved recording selection, oversized file, file-reading lock, and tag-preserving canonical save.
- Contracts final complete suite: 102 files / 1000 tests passed.
- Final seeded Playwright rerun: four real-browser flows passed (4m10s including cleanup): AI MD-file generation/correction/application/autosave/reload with preserved canonical tags, template lifecycle, blank Markdown publish/respond/default report, named template creation. Owned isolation resources were released.
- Independent read-only review found canonical tag loss and the default JSON parser envelope limit. Regression tests reproduced both; fixes and final reruns are recorded before delivery.
- Parent PR #4475 failing privacy allowlist test reproduced the expanded public collection fields. Its allowlist is updated explicitly; 30 permission-propagation tests passed. No secret or private report field is allowed.

## Separate real-model lane

Executed `scripts/survey-real-model-proposal.ts` using existing local deployment credentials without logging keys or upstream errors. No loopback fallback was permitted.

- Provider: `dashscope`; model: `qwen3.8-max`.
- Final rerun execution ID: `71210f47-177a-4faf-9f09-f71c857d610c`.
- Generated at: `2026-09-27T18:38:13.290Z` (UTC).
- Source SHA-256: `4195864ea207e0513ea9edc26d51a2b56e72443c3c05b573b9bf5167bf66b2f3`.
- Returned Markdown compiled successfully into five questions (single/multi/rating/open), with no generated answer statistics. Both the earlier and final real-model runs succeeded; no test provider fallback was allowed.

This application real-model lane is separate from deterministic browser regression. It is not evidence of a production HTTPS browser roundtrip, embedded live ASR, or a fully green repository/PR. CI and final checks remain delivery gates.

## Delivery blocker disposition

Final complete web rerun: 647 files passed; 5482 tests passed, 5 existing skipped; exit 0 (367.07s). The preceding concurrent-build run timed out in the autosave-conflict test. That regression now advances a fake clock through the actual production debounce and asserts one write, preserved local content, and no repeated retry; focused UI rerun passed 29 tests before the complete rerun. PR CI remains a separate gate.

An earlier browser rerun was cancelled before test results when stopping for the unrelated full-suite blocker; it is not a passing result. Its owned temporary isolation stack was explicitly cleaned up.

Initial full web suite on 2026-09-28: 645 files passed, 2 failed; 5472 tests passed, 7 failed, 5 skipped. Focused rerun of both failing files: chat canvas passed; six whiteboard image tests still failed because Node WebCrypto rejects a jsdom-realm ArrayBuffer. Both whiteboard implementation and test were identical to fetched origin/main (`git diff --quiet` exit 0). User explicitly authorized a separate fix, tracked in #4478 / PR #4481. Test-only Buffer bridging retains the real bound WebCrypto digest; known SHA-256 regression went RED then GREEN. Whiteboard/chat: 36 passed; its complete web baseline: 645 files / 5471 tests passed, 5 existing skipped. AI branch includes that fix to make final local verification reproducible.

Parent #4475 privacy allowlist fix d18238ba5 passed CI. Its subsequent serializer review was addressed in 4bd2d6369 / 8af598aff: valid edits use the shared canonical serializer, invalid local edits invalidate the publication source, raw spaces/newlines remain editable. Focused regression: 23 passed; review thread replied to and resolved. An externally enabled auto-merge was disabled before resolution. Subsequent CI and final AI full-suite rerun remain delivery gates; human merge only. Final isolated API rerun: 12 passed. `./init.sh` default baseline: exit 0.
