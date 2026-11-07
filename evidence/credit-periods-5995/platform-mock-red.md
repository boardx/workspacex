[stack-admission] load1=6.48 cores=10 perCore=0.65 running=0/2
[test-isolation] id=run-mvtzok6l-556517a9-b150359e96e9 db=wsx_b150359e96e969890a94 compose=wsx-b150359e96e969890a94 pg=20838 redis=21838 api=24838 web=25838 sandbox=26838 model=27838 deep-agent=28838 asr=29838 vision=30838 loopback-sandbox=31838 mail=19838

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_b150359e96e969890a94 capacity=100 current=6 required=32
 ❯ tests/model/pg-platform-model-test-repository.test.ts (21 tests | 2 failed) 14ms
   × platform start receipt persistence > persists optional formal platform provenance undefined without fake run identities 3ms
     → Cannot read properties of undefined (reading 'balance')
   × platform start receipt persistence > persists optional formal platform provenance 0c479acf-6523-4d3c-84b8-1986a40255aa without fake run identities 0ms
     → Cannot read properties of undefined (reading 'balance')

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/model/pg-platform-model-test-repository.test.ts > platform start receipt persistence > persists optional formal platform provenance undefined without fake run identities
 FAIL  tests/model/pg-platform-model-test-repository.test.ts > platform start receipt persistence > persists optional formal platform provenance 0c479acf-6523-4d3c-84b8-1986a40255aa without fake run identities
TypeError: Cannot read properties of undefined (reading 'balance')
 ❯ PgCreditConsumption.reserveInSession src/infrastructure/billing/pg-credit-consumption.ts:29:143

 ❯ src/infrastructure/auth/pg-token-usage-repository.ts:30:7
 ❯ PgTokenUsageRepository.startRequest src/infrastructure/auth/pg-token-usage-repository.ts:29:5
 ❯ tests/model/pg-platform-model-test-repository.test.ts:129:3

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 Test Files  1 failed (1)
      Tests  2 failed | 19 passed (21)
   Start at  04:21:54
   Duration  3.77s (transform 554ms, setup 5ms, collect 714ms, tests 14ms, environment 0ms, prepare 30ms)

[db-isolation] db=wsx_b150359e96e969890a94 peak_connections=1
undefined
/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: vitest run tests/model/pg-platform-model-test-repository.test.ts
[timing] pnpm --filter @repo/api exec vitest run tests/model/pg-platform-model-test-repository.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：4s
  清理：0s
  总计：5s
