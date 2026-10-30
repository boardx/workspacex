[stack-admission] load1=7.53 cores=10 perCore=0.75 running=0/2
[stack-admission] 排到了，等了 0s
[test-isolation] id=run-mvty9pb4-f5d89f22-4de057b21ac3 db=wsx_4de057b21ac365c2e4ec compose=wsx-4de057b21ac365c2e4ec pg=20872 redis=21872 api=24872 web=25872 sandbox=26872 model=27872 deep-agent=28872 asr=29872 vision=30872 loopback-sandbox=31872 mail=19872

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_4de057b21ac365c2e4ec capacity=100 current=6 required=32
 ❯ tests/billing/credit-period-lifecycle-pg.test.ts (6 tests | 1 failed | 5 skipped) 10268ms
   × preserves debt through expiry and a partial recharge 76ms
     → expected { ownerType: 'user', …(10) } to match object { balance: -3, …(3) }
(7 matching properties omitted from actual)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/billing/credit-period-lifecycle-pg.test.ts > preserves debt through expiry and a partial recharge
AssertionError: expected { ownerType: 'user', …(10) } to match object { balance: -3, …(3) }
(7 matching properties omitted from actual)

- Expected
+ Received

  Object {
    "balance": -3,
    "permanentBalance": -3,
    "subscriptionCredits": 0,
-   "subscriptionExpiresAt": "2026-10-30T19:42:42.212Z",
+   "subscriptionExpiresAt": null,
  }

 ❯ tests/billing/credit-period-lifecycle-pg.test.ts:80:37
     78|   const f = await fixture("debt", 2);
     79|   await f.grant(); await f.consume(20_005_000);
     80|   expect((await f.wallet()).wallet).toMatchObject({balance: -3, perman…
       |                                     ^
     81|   await asApp(org, c => c.query("UPDATE credit_wallets SET balance=bal…
     82|   await f.expire();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  1 failed | 5 skipped (6)
   Start at  03:42:22
   Duration  19.48s (transform 1.71s, setup 23ms, collect 1.93s, tests 10.27s, environment 0ms, prepare 150ms)

[db-isolation] db=wsx_4de057b21ac365c2e4ec peak_connections=2
undefined
/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: vitest run tests/billing/credit-period-lifecycle-pg.test.ts -t preserves debt
[timing] pnpm --filter @repo/api exec vitest run tests/billing/credit-period-lifecycle-pg.test.ts -t preserves debt
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：21s
  清理：1s
  总计：22s
