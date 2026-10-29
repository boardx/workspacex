[stack-admission] load1=5.62 cores=10 perCore=0.56 running=0/2
[test-isolation] id=run-mvtzqqca-bc4da82b-88c3fd6053c7 db=wsx_88c3fd6053c70287c57a compose=wsx-88c3fd6053c70287c57a pg=20760 redis=21760 api=24760 web=25760 sandbox=26760 model=27760 deep-agent=28760 asr=29760 vision=30760 loopback-sandbox=31760 mail=19760

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_88c3fd6053c70287c57a capacity=100 current=6 required=32
 ✓ tests/model/pg-platform-model-test-repository.test.ts (21 tests) 17ms

 Test Files  1 passed (1)
      Tests  21 passed (21)
   Start at  04:23:35
   Duration  3.68s (transform 550ms, setup 5ms, collect 691ms, tests 17ms, environment 0ms, prepare 28ms)

[db-isolation] db=wsx_88c3fd6053c70287c57a peak_connections=1
[timing] pnpm --filter @repo/api exec vitest run tests/model/pg-platform-model-test-repository.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：4s
  清理：0s
  总计：4s
