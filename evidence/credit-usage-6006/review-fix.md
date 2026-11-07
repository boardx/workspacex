[stack-admission] load1=4.82 cores=10 perCore=0.48 running=0/2
[stack-admission] 排到了，等了 0s
[test-isolation] id=run-mvuc4lw5-e88a9f20-6849841ecced db=wsx_6849841eccedaf693f39 compose=wsx-6849841eccedaf693f39 pg=20614 redis=21614 api=24614 web=25614 sandbox=26614 model=27614 deep-agent=28614 asr=29614 vision=30614 loopback-sandbox=31614 mail=19614

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_6849841eccedaf693f39 capacity=100 current=6 required=32
 ✓ tests/auth/ai-usage-repository.test.ts (15 tests) 10084ms
 ✓ tests/billing/subscription-credit-backfill.test.ts (6 tests) 317ms
 ✓ tests/billing/personal-credit-usage.test.ts (3 tests) 520ms

 Test Files  3 passed (3)
      Tests  24 passed (24)
   Start at  10:10:18
   Duration  15.26s (transform 693ms, setup 10ms, collect 1.26s, tests 10.92s, environment 0ms, prepare 85ms)

[db-isolation] db=wsx_6849841eccedaf693f39 peak_connections=4
[timing] pnpm --filter @repo/api exec vitest run tests/billing/personal-credit-usage.test.ts tests/billing/subscription-credit-backfill.test.ts tests/auth/ai-usage-repository.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：16s
  清理：0s
  总计：16s
