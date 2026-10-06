# Repeated relevance validation failures: private per-call diagnostics

Issue: #5427. This change adds safe private diagnostics; it does not claim the real protocol failure or performance problem is fixed.

## Actual failed acceptance

Real browser normal login, owned app_rw PGlite, real DashScope qwen3.8-max and real search; source SHA `119e1c450b3eff998a805e3b538b038505ed1cda`. A normal 258-character Chinese SME knowledge-base request produced seven enabled plans and 40 tasks, all retained. The 2026-10-06T04:43:22.199Z research run was manually paused at 05:09:18.208Z after 25m56s. Persisted state confirms busy=false, controlStatus=paused, completed=false: 103 research model calls (54 failed, 49 succeeded), four successful tasks, 18 failed and 18 pending; eight accepted retrieved source hashes preserved. No formal report passed. PGlite is not cloud PostgreSQL compatibility evidence.

First connection-loss UI was refreshed through the normal browser; GET runtime/progress returned 200 and restored the existing busy execution. No duplicate generation command was sent. Exact rejected fields are still UNKNOWN because old runtime only preserved public reason codes. Private tenant-scoped state retained at `/private/tmp/research-5427-real-evidence/private-runtime-paused.json` (0600); only bounded counters and hashes are included here.

## Controlled verification

RED `/private/tmp/research-5427-red-final.log`: three failing diagnostics assertions, 21 passing; exit 1. The real runtime service/task pipeline consumed invalid responses with no per-call diagnostic before this change.

Final `/private/tmp/research-5427-full-final.log`: 23 files / 528 tests passed; exit 0. Focused diagnostics 27 passed (`/private/tmp/research-5427-focused-final.log`). API typecheck and lint actual exit 0 (`/private/tmp/research-5427-type-final.log`, `/private/tmp/research-5427-lint-final.log`). `git diff --check` exit 0.

Coverage includes failed repair, repaired valid negative output retaining the first failure event, strict task/question rejection, no source admission on invalid output, provider errors not mislabeled as validation, malicious error fields/code/message/raw output, and throwing sinks/getters not changing the original failure. Two-attempt repair and strict evidence gates remain unchanged. Only existing allowlisted error code/type/status and bounded schema field paths are recorded privately, with session/call/request correlation; no model content or quote is logged.

## Outstanding

Exact changed SHA must be independently reviewed and CI green. Resume the same preserved session under the reviewed diagnostic version to obtain actual fixed-schema failure categories before deciding a protocol repair. Three complete real normal reports and original-session recovery remain unpassed; unit or CI success is not performance evidence.
