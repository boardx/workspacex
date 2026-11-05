# Shared queue Chat refresh diagnosis (#6249)

Scope: a manual observation, not a product fix or a full-regression result.

Confirmed queue failures:
- #6286 candidate af1be44d6dcd1bf4de398eafc13f090980adc0eb, run42012436028/job127195398443.
- #6286 candidate ba75827a62b66b184fba5de59c7804b4138935d5, run42013977395/job127200482941.
- Both fail agent-chat-core-paths.spec.ts:95 after reload: messages element absent for the unchanged 30s budget. Stored human/agent message assertions before reload passed. Snapshot shows session confirmation; chat layout chunk did not finish in trace. In ba758 root layout completed after12.766s, chat layout remained unfinished.
- #6274 trace differs: layout/identity completed and the shell mounted, but groups of API requests remained unfinished. A trace status/time=-1 alone cannot locate browser queuing, Next proxy delay or API/PG waits.

## Minimal observation

`WSX_CHAT_REFRESH_DIAGNOSTICS=1` wraps only the existing Next/API launch commands. It records fixed route categories, request/finish/close timestamps, status and active/socket counts; child output retains compilation durations and error/warning categories. No URI, query, headers, body, SQL, token or arbitrary exception message is retained. Per-process files and launcher files are capped at1MiB including restart/rebuilt writers. No new PG connection, polling loop or CDP observer. The default launcher and test assertions/budgets remain unchanged.

The wrapper owns one detached process group. TERM/INT/HUP/QUIT terminate it, a3s deadline kills survivors, and process exit synchronously kills the owned group. SIGKILL itself is uncatchable; the existing isolation runner remains responsible for whole-stack cleanup.

## Explicit Linux experiment (requires coordinator resource grant)

Existing GitHub workflow: harness-acceptance.yml, hosted ubuntu-latest; Node from .nvmrc, pnpm frozen lockfile, Chromium from the locked Playwright installation, PostgreSQL/Redis images from the existing isolated chat-read configuration. No production environment or secret is referenced.

```
gh workflow run harness-acceptance.yml --ref worker/chat-refresh-diagnostics-6249 -f verification_lane=chat-refresh -f run_e2e_full=false -f fresh_run=true
```

The new input has not yet been dispatched; whether GitHub accepts this branch version before the choice exists on default is unverified. Report an API rejection explicitly rather than starting broader lanes.

The only runnable job in this mode executes:

```
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.chat-read.config.ts --project=chat-read --workers=2 --grep '简单聊天：一轮问答|复杂任务把 write_todos' --max-failures=1 --reporter=line
```

All other manual jobs skip and use diagnostic-skipped display names, preventing their SKIPPED checks from overwriting ordinary PR/queue check names on the same SHA. Automatic PR/merge-group and all/base names/matrix suffixes retain their original values. This experiment is not included in the required aggregate dependency lists.

Resource scope: one isolated PG/Redis/API/Next stack, existing deterministic upstreams and two Chromium workers. Do not expand to the full shard or repeat automatically. After the run, verify isolation cleanup and absence of its owned process group/containers; only this task's resources may be removed.

## Local evidence (Darwin, not Linux)

- Existing full-regression11, doc-smoke6 and browserless chat-shards5 checks passed.
- Final branch-routing11 + manual routing/display-name7 checks passed (18 total).
- Redaction/path/file-cap unit3 passed, including rebuild and already-full file counterexamples.
- Pure Node lifecycle fixture7 passed: normal child exit, launch failure, TERM, HUP, QUIT, child exception and wrapper exception all leave the recorded owned grandchild absent. No Docker/browser/database involved.
- No Linux experiment, queue rerun, merge or production action has been performed for this diagnostic change. The shared product root cause is still unresolved.
