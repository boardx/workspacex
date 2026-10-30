[stack-admission] load1=9.83 cores=10 perCore=0.98 running=1/2
[stack-admission] 排到了，等了 0s
[test-isolation] id=run-mvueqlmv-7cfe6922-6e50371ef481 db=wsx_6e50371ef481147b6449 compose=wsx-6e50371ef481147b6449 pg=20750 redis=21750 api=24750 web=25750 sandbox=26750 model=27750 deep-agent=28750 asr=29750 vision=30750 loopback-sandbox=31750 mail=19750

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_6e50371ef481147b6449 capacity=100 current=6 required=32
 ❯ tests/billing/subscription-credit-backfill.test.ts (7 tests | 1 failed) 25808ms
   ✓ dry-run verifies payment without touching balance, then concurrent helper/application and rerun grant once 396ms
   × blocks a no-grant locked reread and recovers the same invoice even after a legacy ok audit 101ms
     → expected { scanned: 1, eligible: 1, …(6) } to match object { blocked: 1, applied: +0, …(1) }
(5 matching properties omitted from actual)
 ❯ tests/billing/subscription-credit-checkpoint.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/billing/subscription-credit-checkpoint.test.ts [ tests/billing/subscription-credit-checkpoint.test.ts ]
Error: Failed to load url ../../src/infrastructure/billing/subscription-credit-checkpoint (resolved id: ../../src/infrastructure/billing/subscription-credit-checkpoint) in /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/tests/billing/subscription-credit-checkpoint.test.ts. Does the file exist?
 ❯ loadAndTransform ../../node_modules/.pnpm/vite@5.4.21_@types+node@22.20.1_terser@5.50.0/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/billing/subscription-credit-backfill.test.ts > blocks a no-grant locked reread and recovers the same invoice even after a legacy ok audit
AssertionError: expected { scanned: 1, eligible: 1, …(6) } to match object { blocked: 1, applied: +0, …(1) }
(5 matching properties omitted from actual)

- Expected
+ Received

  Object {
-   "applied": 0,
-   "blocked": 1,
+   "applied": 1,
+   "blocked": 0,
    "nextAfter": "cbf-test-race",
  }

 ❯ tests/billing/subscription-credit-backfill.test.ts:70:29
     68|  });
     69|  try{
     70|   expect(await reconcile()).toMatchObject({blocked:1,applied:0,nextAft…
       |                             ^
     71|   expect((await asOwner(c=>c.query("SELECT count(*)::int AS n FROM bil…
     72|   // Older code could already have committed an ok event without grant…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯

 Test Files  2 failed (2)
      Tests  1 failed | 6 passed (7)
   Start at  11:23:25
   Duration  34.68s (transform 730ms, setup 30ms, collect 433ms, tests 25.81s, environment 0ms, prepare 250ms)

[db-isolation] db=wsx_6e50371ef481147b6449 peak_connections=3
undefined
/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: vitest run tests/billing/subscription-credit-backfill.test.ts tests/billing/subscription-credit-checkpoint.test.ts
[timing] pnpm --filter @repo/api exec vitest run tests/billing/subscription-credit-backfill.test.ts tests/billing/subscription-credit-checkpoint.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：37s
  清理：2s
  总计：39s
