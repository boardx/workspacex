[stack-admission] load1=21.94 cores=10 perCore=2.19 running=0/2
[stack-admission] 排到了，等了 0s
[test-isolation] id=run-mvtxwxoo-257c6fa1-17036a5ebcec db=wsx_17036a5ebcec130ac93e compose=wsx-17036a5ebcec130ac93e pg=20625 redis=21625 api=24625 web=25625 sandbox=26625 model=27625 deep-agent=28625 asr=29625 vision=30625 loopback-sandbox=31625 mail=19625

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_17036a5ebcec130ac93e capacity=100 current=6 required=32
 ❯ tests/billing/credit-periods-pg.test.ts (1 test | 1 failed) 22642ms
   × exposes existing negative balance as permanent debt with no subscription credits 29ms
     → expected { ownerType: 'user', …(7) } to match object { balance: -1.25, …(3) }
(7 matching properties omitted from actual)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/billing/credit-periods-pg.test.ts > exposes existing negative balance as permanent debt with no subscription credits
AssertionError: expected { ownerType: 'user', …(7) } to match object { balance: -1.25, …(3) }
(7 matching properties omitted from actual)

- Expected
+ Received

  Object {
    "balance": -1.25,
-   "permanentBalance": -1.25,
-   "subscriptionCredits": 0,
-   "subscriptionExpiresAt": null,
  }

 ❯ tests/billing/credit-periods-pg.test.ts:32:18
     30| it("exposes existing negative balance as permanent debt with no subscr…
     31|   const {wallet} = await repository.wallet({orgId: org, ownerType: "us…
     32|   expect(wallet).toMatchObject({balance: -1.25, permanentBalance: -1.2…
       |                  ^
     33| });
     34| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  1 failed (1)
   Start at  03:32:28
   Duration  31.29s (transform 496ms, setup 10ms, collect 236ms, tests 22.64s, environment 0ms, prepare 97ms)

[db-isolation] db=wsx_17036a5ebcec130ac93e peak_connections=2
undefined
/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: vitest run tests/billing/credit-periods-pg.test.ts
[timing] pnpm --filter @repo/api exec vitest run tests/billing/credit-periods-pg.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：34s
  清理：1s
  总计：36s
