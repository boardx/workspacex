[stack-admission] load1=7.82 cores=10 perCore=0.78 running=0/2
[test-isolation] id=run-mvtz1c5b-32e7ca2d-f150878066d3 db=wsx_f150878066d37bb915f2 compose=wsx-f150878066d37bb915f2 pg=20624 redis=21624 api=24624 web=25624 sandbox=26624 model=27624 deep-agent=28624 asr=29624 vision=30624 loopback-sandbox=31624 mail=19624

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_f150878066d37bb915f2 capacity=100 current=6 required=32
 ✓ tests/billing/credit-model-pg.integration.test.ts (4 tests) 8527ms
 ✓ tests/billing/credit-stream-settlement.test.ts (4 tests) 893ms
 ✓ tests/billing/private-auxiliary-credit-pg.test.ts (5 tests) 567ms
 ✓ tests/billing/credit-admission-policy-pg.test.ts (6 tests) 613ms

 Test Files  4 passed (4)
      Tests  19 passed (19)
   Start at  04:03:51
   Duration  15.91s (transform 635ms, setup 14ms, collect 1.57s, tests 10.60s, environment 0ms, prepare 119ms)

[db-isolation] db=wsx_f150878066d37bb915f2 peak_connections=3
[timing] pnpm --filter @repo/api exec vitest run tests/billing/credit-model-pg.integration.test.ts tests/billing/private-auxiliary-credit-pg.test.ts tests/billing/credit-stream-settlement.test.ts tests/billing/credit-admission-policy-pg.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：16s
  清理：0s
  总计：17s
