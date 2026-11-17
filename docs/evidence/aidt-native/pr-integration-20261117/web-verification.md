# AIDT integrated PR Web verification

Worktree: `/workspace/aidt-pr-20261117`.
Integrated HEAD: `1a2ec212d38635a60b1337cc4a949ec564c0d7a8`; develop base: `4060bcf2017ef5775b762f2135f22042f8a96d19`.

| Check | Actual result | Log / explicit status |
| --- | --- | --- |
| AIDT existing Web regression (`pnpm exec vitest run aidt`) | 96 files, 818 tests passed; 39.74s; exit 0 | `/tmp/aidt-pr-web-aidt.log`, `/tmp/aidt-pr-web-aidt.exit` |
| Ordinary Chat/member communication/shared research export component regression | 21 files, 192 tests passed; 22.26s; exit 0 | `/tmp/aidt-pr-web-shared.log`, `/tmp/aidt-pr-web-shared.exit` |
| Stage/summary consumers after contracts revision-bound fix | 7 files, 67 tests passed; 7.29s; exit 0 | `/tmp/aidt-pr-web-post-contract.log`, `/tmp/aidt-pr-web-post-contract.exit` |
| Complete Web typecheck after contracts fix (`pnpm exec tsc --noEmit --incremental false`) | exit 0, empty diagnostics log | `/tmp/aidt-pr-web-typecheck.log`, `/tmp/aidt-pr-web-typecheck.exit` |

The 818-test suite is a fresh execution on the integrated baseline, not the historical release run. It preceded the backend agent's revision-bound fix; the seven affected consumer files were subsequently rerun after that fix. Their 67 assertions overlap the full suite and must not be counted as 67 additional unique tests. Web typecheck was started only after the backend agent reported its contract writes stable. The post-fix contract blob was `542447eafeedcfa8d3495dbaee0f1e4fc9630ad0`.

Shared tests covered canonical composer accessible name, recording send/scroll, frozen selector and ordinary failure retry, new draft/attachment/mention preservation, shell thread navigation, lazy attachment threads, attachment rendering/strip, host acceptance and return navigation, draft handoff, project creation, Board handoff retries, global member launcher/messages/topic transitions, genuine research DOCX output and isolated PDF-print image decode/cleanup failure cases. These are local component/unit checks; they do not prove browser geometry, devapp deployment, model behavior or classroom acceptance.

Environment used the assigned absolute Node/pnpm paths and external virtual store, `WORKSPACEX_WEB_TEST_MAX_WORKERS=2`; suites were run sequentially. First attempt failed before collection because the external virtual store's jest-dom could not resolve public-hoisted vitest. That failure is preserved as `/tmp/aidt-pr-web-aidt-attempt01.log` and `.exit` (1, no tests). Repaired only `/tmp/aidt-pr-virtual-store/node_modules/vitest` as a link to the already-installed package; no source, lockfile or dependency version changed. The new run completed successfully. Some legacy shared component tests print deliberately simulated `MODEL_CALL_FAILED` errors or SDK relative-URL diagnostics; Vitest reports no unhandled failure and explicit exit 0. No external model service was used.

Machine-readable receipts, counts, source identities and SHA256 log digests: `/tmp/aidt-pr-web-validation.json`.

No Web source edits by this reviewer; backend agent owns the two tracked dirty files (stage contract and its API tests). No browser, Docker, model, push, merge or deployment was started by this reviewer. Remote CI and devapp acceptance remain separate checks.
