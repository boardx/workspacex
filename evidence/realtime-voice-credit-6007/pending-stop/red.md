[stack-admission] load1=9.81 cores=10 perCore=0.98 running=1/2
[stack-admission] 排到了，等了 0s
[test-isolation] id=run-mvugmcuu-871dfcd5-7354177c946f db=wsx_7354177c946fbb3f517e compose=wsx-7354177c946fbb3f517e pg=20876 redis=21876 api=24876 web=25876 sandbox=26876 model=27876 deep-agent=28876 asr=29876 vision=30876 loopback-sandbox=31876 mail=19876

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_7354177c946fbb3f517e capacity=100 current=6 required=32
 ❯ tests/billing/realtime-voice-credit-pg.test.ts (7 tests | 1 failed) 32306ms
   ✓ bills cumulative provider response usage once, completes into debt and blocks a new connection 341ms
   × settles a confirmed nondispatch and releases its durable slot on stop during admission 1064ms
     → Matcher did not succeed in 1000ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/billing/realtime-voice-credit-pg.test.ts > settles a confirmed nondispatch and releases its durable slot on stop during admission
Error: Matcher did not succeed in 1000ms
 ❯ tests/billing/realtime-voice-credit-pg.test.ts:93:187


Caused by: AssertionError: expected { state: 'pending', debit: null } to deeply equal { state: 'settled', debit: '0' }

- Expected
+ Received

  Object {
-   "debit": "0",
-   "state": "settled",
+   "debit": null,
+   "state": "pending",
  }

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
   Start at  12:16:05
   Duration  47.56s (transform 1.87s, setup 26ms, collect 2.62s, tests 32.31s, environment 0ms, prepare 198ms)

[db-isolation] db=wsx_7354177c946fbb3f517e peak_connections=4
undefined
/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: vitest run tests/billing/realtime-voice-credit-pg.test.ts
[timing] pnpm --filter @repo/api exec vitest run tests/billing/realtime-voice-credit-pg.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：49s
  清理：1s
  总计：49s
