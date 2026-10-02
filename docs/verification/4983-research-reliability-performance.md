# Research reliability and performance — issue #4983

## Scope

User-approved direct fix; refreshed and fast-forwarded to main `d19128e17`
before the 2026-10-02 implementation continuation, preserving task changes.
The existing primary checkout is reused; no new worktree or gateway is used.

- Transient search/document HTTP 429/502/503/504 and network errors get at most
  two fetch attempts within the original abort deadline. Permanent HTTP errors
  and cancellation do not automatically retry.
- Document reads follow at most three redirects, validating every destination
  and DNS result before fetching. Private/metadata destinations remain blocked.
- Search and document queues keep at most three producers active. Completed
  results persist without waiting for a slow sibling. Empty-result recovery
  runs after initial results persist, so slow rewritten queries cannot block them.
- Evidence extraction keeps at most two independent batches active. Final evidence
  order remains deterministic, writes/progress are serialized, and all existing
  quote, relevance, citation and report quality gates remain enforced.
- Completed documents and report checkpoints continue to be reused. Chapter
  generation stays serial to preserve provider-delta order and validated prefixes.
- Topic edits autosave after an 800 ms debounce and remain on the topic step.
  Saves are serialized; failure retains input with an explicit retry. A durable
  polling result can complete a save whose POST never closes. Scope changes still
  invalidate stale downstream results; no evidence or validation gate is bypassed.
- Research progress polling omits document bodies and unchanged source metadata
  through a cursor. A terminal response reloads the full runtime. Failure details
  are available in a collapsed list without restoring the removed plan card.

## Verification

### 2026-10-02 continuation (in progress)

- A red regression reproduced exhausted transient-search budgets preventing a
  manual retry from calling search. Manual transport retry now permits one new
  attempt while retaining the automatic bound and completed sources.
- A red regression reproduced missing lightweight research metadata. Progress
  now projects task state and source display metadata without document bodies;
  an unchanged source cursor omits the source array. Client polling uses this
  endpoint during research, then reloads full state on termination.
- Current API research unit suite: 8 files, 189 tests passed, exit 0.
- Client progress merge: 5 tests passed, exit 0. Step transitions: 13 tests
  passed, exit 0. Live/recovery suites: 21 tests passed in the prior combined
  run; that combined run was red due to a stale transition test mock, corrected
  and independently rerun above.
- Current web `tsc --noEmit`: exit 0; API typecheck and API/web lint: exit 0.
  The first API lint attempt hit sandbox IPC EPERM; an approved rerun passed.
- Current affected frontend regression: 25 TSX files, 231 tests passed, plus
  progress/stream-client 2 files, 8 tests passed. The suite was rerun after updating
  obsolete manual-save expectations and preserving invalid-direction blocking.
- Autosave regressions first reproduced missing autosave, lost queued edits,
  and a never-closing POST leaving the UI dirty despite successful persistence.
  All now pass. Independent read-only re-review reports no blocking finding.
- Browser reads timed out twice; no current production response or provider
  failure details were inspected. Screenshot sizes alone are not root-cause proof.
- Current isolated database integration: 5 files, 59 tests passed, exit 0,
  including 44 persistence tests and autosave reload through another service
  instance. Admission waited 135 seconds; execution took 153 seconds. Its owned
  compose project `wsx-1662137908cd6aba3b47` was cleaned; Docker query found no
  remaining containers. Contracts: 4 files, 43 tests passed; typecheck exit 0.
- Current browser run completed the UI workflow but failed the final expected
  audit-call count (7 vs 6). The new autosave test had edited the goal sentinel
  used by `loopback-guided-research.ts` to inject one invalid evidence response,
  disabling that existing failure drill. The test now edits custom focus instead,
  retaining the sentinel and all audit/retry assertions. Fullstack rerun pending;
  no browser pass is claimed. First run took 9m47s after 155s admission wait;
  compose project `wsx-c0c50a313bae28cf99e7` was cleaned by the wrapper.
- Corrected browser fullstack rerun: 1 passed, including the original failed
  evidence repair/audit assertions and the new autosave/reload checks. Browser
  assertions took 2 minutes; Playwright including production build took 11.5
  minutes. This uses an explicit controlled HTTP model provider, not a real
  external-model quality benchmark. No assertion or timeout was weakened.

- Regression tests first exposed slow-sibling blocking, missing safe redirects,
  absent transient recovery and serial evidence extraction. Independent review
  additionally found slow empty-result recovery still blocking initial commits;
  a deferred-recovery test reproduced it before the follow-up fix. Re-review
  found no remaining blocking issue by inspection.
- `./init.sh` — exit 0, default baseline verification (not a full-suite claim).
- `pnpm --filter @repo/api test:research-unit` — 7 files, 183 tests passed.
  Includes draining in-flight producers before propagating persistence failure,
  preserving private-address denial across redirects, bounded retries and
  deterministic evidence/progress despite out-of-order completion.
- Controlled fake-clock document queue: durations 100/10/10/100/10/10/100 ms,
  concurrency 3; completion-as-ready finishes at 130 ms versus the former
  three batch barriers' calculated 300 ms. This is not production benchmarking.
- Affected web tests: report-stream, stream-client, checkpoints-live,
  search-recovery and timeline — 5 files, 39 tests passed.
- Final `pnpm --filter @repo/api typecheck` and `pnpm --filter @repo/api lint`
  — both exit 0. `git diff --check` — exit 0.
- Browser integration first attempt: isolated production web build exceeded the
  existing 600-second server-start window; zero browser assertions executed.
  The isolation wrapper cleaned its compose project `wsx-357f0d7bebbb860d8494`;
  a subsequent Docker label query returned no containers for that project.
  Retrying with the config's documented slow-machine startup override of
  1200000 ms; assertions, test timeout and resource admission are unchanged.
- Second browser attempt also exceeded 1200000 ms before server readiness:
  compilation succeeded, but type checking/page build did not finish in the
  window. Zero browser assertions executed; this is NOT a passing E2E run.
  Its compose project `wsx-baed9cee19cf4fc2892b` had no remaining containers.
- `pnpm run verify:quick` began the affected API lint/typecheck/test suite after
  resource admission. The complete `guided-runtime-persistence.test.ts` file
  reported 43 passed, including actual PostgreSQL checkpoint reload, SSE
  observer disconnect, unfinished-chapter resume and search recovery. The wider
  run was interrupted after prolonged execution; its outer exit status is not
  evidence of suite completion. No full affected-suite pass is claimed.
  The owned remaining temporary PostgreSQL container/volume was removed with
  `docker compose -f apps/api/docker-compose.dev.yml -p wsx-fd4109559aa0ba6973b7 down -v`.

## Boundaries

The screenshot does not establish a production root cause. No production logs,
real external-provider outage drill or before/after production timings are claimed.
Retries are bounded: inaccessible sites may still fail, and evidence gaps remain
visible rather than being filled with unverified summaries. Relevance screening,
supplemental searches and chapter generation are not made fully parallel.
No deployment, merge, model change or quality-gate relaxation is included.
Current affected regressions, isolated integration and browser acceptance pass.
The earlier wider `verify:quick` interruption remains recorded above; no complete
repository-wide suite is claimed. Delivery targets the named branch and issue;
deployment and merge remain outside this request. Other sessions were not stopped.

## Delivery handoff

```mermaid
flowchart LR
 A[同步代码与确认范围] --> B[补回归测试] --> C[优化检索与读取及自动保存] --> D[优化报告生成] --> E[回归与数据库及浏览器验证] --> F[统一提交 PR]
 classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827;
 classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827;
 classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827;
 classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827;
 class A,B,C,D,E tested;
 class F todo;
```

This is an ad-hoc issue, not a feature-list state transition. No feature is marked
passing by this change. The implementation branch is
`codex/research-reliability-performance`; issue #4983 records the live progress.
Reproduction commands (run heavy checks serially on a constrained host):

```sh
pnpm run verify:quick
FULLSTACK_E2E_SERVER_TIMEOUT_MS=1200000 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded-github-import e2e/guided-research-runtime.spec.ts
```

Do not run the two heavy checks concurrently on the same constrained host.
PR is associated with `Closes #4983`; after creation inspect
`gh pr view codex/research-reliability-performance --json url,headRefOid,statusCheckRollup,mergeStateStatus`
and use the repository's `classifyChecks`/PR queue policy, not a hand-written
definition of green. Do not deploy, merge or restart production without authority.
Any integration startup timeout remains an environment failure, not a passing test.
