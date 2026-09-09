# Skill fullstack CI evidence — 2026-09-10

[CI run and successful fullstack job](https://github.com/boardx/workspacex/actions/runs/34407301634/job/102653247976) completed with **79 passed, 0 failed, 0 flaky and 1 skipped**. The skip is the existing `inbox-smoke.spec.ts:67` fixme for opening submitted feedback in the inbox drawer; it is not a Skill test.

The tested runtime is [c3e1cb929e33ed45db8d84ce14ba133683de0c2d](https://github.com/boardx/workspacex/commit/c3e1cb929e33ed45db8d84ce14ba133683de0c2d), plus [test-only proxy correction 7d945be6cfe19bd12cd73a2cdd9265ead6fe28ae](https://github.com/boardx/workspacex/commit/7d945be6cfe19bd12cd73a2cdd9265ead6fe28ae). The latter changes only E2E-origin-gated notification rewrites and their direct proxy regression tests: two files, 18 inserted lines. It does not change the production notification implementation.

Each of the five `skill-agent-import-usecase-audit.spec.ts` cases actually ran once and passed:

| Case | Duration |
| --- | --- |
| GitHub Skill import | 5,025 ms |
| Complete imported file browser and editor | 2,621 ms |
| Agent import, edit, publish and trial | 5,312 ms |
| Imported Skill trial and output | 3,368 ms |
| Chat slash Skill selection and mounting | 3,109 ms |

The new-organization first-chat reply also passed once in **7,959 ms**. These results are executions, not listings or dependency skips. [selected-results.json](./selected-results.json) contains the extracted structured statistics, selected test results and provenance.

This CI lane uses the standard loopback model and sandbox providers. Its trial assertions verify the application/API flow; they are **not paid-model execution or devapp acceptance evidence**. The separate multi-file save and Agent-pin recovery lane has its own evidence. No raw traces, authentication headers, credentials or session tokens are included here.

This historical candidate receipt does not replace the final integration head CI or a fresh devapp deployment and authenticated acceptance check.

## Final integration head

Independent structured verification of [run 34411307674 / job 102666235254](https://github.com/boardx/workspacex/actions/runs/34411307674/job/102666235254) at exact head `ab859a6976ce4e421068fd3a04bf7aa84523fcd8` confirms **79 passed, 0 failed, 0 flaky and 1 existing inbox fixme skipped**. All five Skill audit cases ran once and passed: import 4,162 ms, full file editor 2,636 ms, Agent import/publish/trial 5,017 ms, Skill trial 3,371 ms, and slash mounting 2,981 ms. First-chat reply passed once in 7,658 ms.

[final-integration-results.json](./final-integration-results.json) preserves the exact-head statistics and selected results separately from the earlier candidate evidence above. This uses standard loopback providers; it is not a new paid-model call or devapp SHA verification. The dedicated multi-file save/pin recovery lane has its own result and is not certified by this report.
