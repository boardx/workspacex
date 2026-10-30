[stack-admission] load1=6.50 cores=10 perCore=0.65 running=0/2
[stack-admission] 排到了，等了 0s
[test-isolation] id=run-mvtybb58-20e43b19-cbbb9e54638f db=wsx_cbbb9e54638f56531839 compose=wsx-cbbb9e54638f56531839 pg=20612 redis=21612 api=24612 web=25612 sandbox=26612 model=27612 deep-agent=28612 asr=29612 vision=30612 loopback-sandbox=31612 mail=19612

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_cbbb9e54638f56531839 capacity=100 current=6 required=32
 ✓ tests/billing/schema-migration.test.ts (16 tests) 8226ms
 ✓ tests/billing/credit-consumption-pg.test.ts (16 tests) 1126ms
stdout | tests/billing/wallet-ledger-query.test.ts
[F03 HTTP fixture] starting database readiness

stdout | tests/billing/wallet-ledger-query.test.ts
[F03 HTTP fixture] database ready; creating Nest fixture
[F03 HTTP fixture] Nest created; binding loopback listener
[F03 HTTP fixture] listener ready

 ✓ tests/billing/wallet-ledger-query.test.ts (9 tests) 542ms
 ✓ tests/billing/credit-period-lifecycle-pg.test.ts (6 tests) 793ms
 ✓ tests/billing/credit-periods-pg.test.ts (1 test) 283ms

 Test Files  5 passed (5)
      Tests  48 passed (48)
   Start at  03:43:36
   Duration  16.09s (transform 650ms, setup 15ms, collect 1.41s, tests 10.97s, environment 0ms, prepare 157ms)

[db-isolation] db=wsx_cbbb9e54638f56531839 peak_connections=4
[timing] pnpm --filter @repo/api exec vitest run tests/billing/credit-periods-pg.test.ts tests/billing/credit-period-lifecycle-pg.test.ts tests/billing/wallet-ledger-query.test.ts tests/billing/credit-consumption-pg.test.ts tests/billing/schema-migration.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：17s
  清理：0s
  总计：17s
