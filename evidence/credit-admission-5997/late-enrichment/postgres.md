[stack-admission] load1=13.43 cores=10 perCore=1.34 running=1/2
[stack-admission] 排到了，等了 0s
[test-isolation] id=run-mvudd70o-df395950-a23ebddcf144 db=wsx_a23ebddcf144f5309ff3 compose=wsx-a23ebddcf144f5309ff3 pg=20828 redis=21828 api=24828 web=25828 sandbox=26828 model=27828 deep-agent=28828 asr=29828 vision=30828 loopback-sandbox=31828 mail=19828

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_a23ebddcf144f5309ff3 capacity=100 current=6 required=32
 ✓ tests/billing/durable-credit-usage.test.ts (17 tests) 2573ms
   ✓ admits twenty normal concurrent starts without spurious accounting failures 431ms
   ✓ repeated confirmed predispatch credit rejection never consumes spool capacity 1680ms
 ✓ tests/billing/credit-stream-settlement.test.ts (5 tests) 25310ms
   ✓ rounds cumulative stream usage once, ignores stale snapshots, and releases the hold only at completion 1004ms
   ✓ persists late terminal counters and pricing through the durable meter without charging again 549ms

 Test Files  2 passed (2)
      Tests  22 passed (22)
   Start at  10:44:59
   Duration  36.48s (transform 1.65s, setup 21ms, collect 2.17s, tests 27.88s, environment 0ms, prepare 194ms)

[db-isolation] db=wsx_a23ebddcf144f5309ff3 peak_connections=3
[timing] pnpm --filter @repo/api exec vitest run tests/billing/durable-credit-usage.test.ts tests/billing/credit-stream-settlement.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：38s
  清理：2s
  总计：40s
