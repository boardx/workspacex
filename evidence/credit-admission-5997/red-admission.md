[stack-admission] load1=4.59 cores=10 perCore=0.46 running=0/2
[stack-admission] 排到了，等了 0s
[test-isolation] id=run-mvtyhedl-3319a30c-e19fda94eef6 db=wsx_e19fda94eef6422303e7 compose=wsx-e19fda94eef6422303e7 pg=20780 redis=21780 api=24780 web=25780 sandbox=26780 model=27780 deep-agent=28780 asr=29780 vision=30780 loopback-sandbox=31780 mail=19780

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_e19fda94eef6422303e7 capacity=100 current=6 required=32
 ❯ tests/billing/credit-admission-policy-pg.test.ts (6 tests | 6 failed) 9138ms
   × admits zero personal balance, completes into debt, then blocks a new physical dispatch 52ms
     → insufficient_credit
   × lets an admitted request cost more than the positive starting balance 38ms
     → insufficient_credit
   × blocks negative personal balance even when the legacy global preflight flag is off 40ms
     → promise resolved "undefined" instead of rejecting
   × admits enterprise debt even when the legacy preflight flag is on 33ms
     → insufficient_credit
   × completes every concurrent request admitted before personal debt becomes visible 26ms
     → insufficient_credit
   × uses the actual balance for availability instead of subtracting an estimated request maximum 33ms
     → expected { ownerType: 'user', …(10) } to match object { balance: 1, …(2) }
(8 matching properties omitted from actual)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/billing/credit-admission-policy-pg.test.ts > admits zero personal balance, completes into debt, then blocks a new physical dispatch
CreditConsumptionError: insufficient_credit
 ❯ PgCreditConsumption.error src/infrastructure/billing/pg-credit-consumption.ts:23:134
     21|   return isLocalOrg(row.kind)?{ownerType:"user",ownerId:userId}:{owner…
     22|  }
     23|  private error(p:Payer,message:string,code:"credit_required"|"credit_a…
       |                                                                                                                                      ^
     24|  async reserveInSession(s:TenantSession,orgId:OrgId,input:Start):Promi…
     25|   const p=await this.payer(s,orgId,input.userId);
 ❯ PgCreditConsumption.reserveInSession src/infrastructure/billing/pg-credit-consumption.ts:53:116
 ❯ PgDatabase.inTx src/infrastructure/db/pg-database.ts:74:19
 ❯ tests/billing/credit-admission-policy-pg.test.ts:49:3

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/6]⎯

 FAIL  tests/billing/credit-admission-policy-pg.test.ts > lets an admitted request cost more than the positive starting balance
CreditConsumptionError: insufficient_credit
 ❯ PgCreditConsumption.error src/infrastructure/billing/pg-credit-consumption.ts:23:134
     21|   return isLocalOrg(row.kind)?{ownerType:"user",ownerId:userId}:{owner…
     22|  }
     23|  private error(p:Payer,message:string,code:"credit_required"|"credit_a…
       |                                                                                                                                      ^
     24|  async reserveInSession(s:TenantSession,orgId:OrgId,input:Start):Promi…
     25|   const p=await this.payer(s,orgId,input.userId);
 ❯ PgCreditConsumption.reserveInSession src/infrastructure/billing/pg-credit-consumption.ts:53:116
 ❯ PgDatabase.inTx src/infrastructure/db/pg-database.ts:74:19
 ❯ tests/billing/credit-admission-policy-pg.test.ts:58:3

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/6]⎯

 FAIL  tests/billing/credit-admission-policy-pg.test.ts > blocks negative personal balance even when the legacy global preflight flag is off
AssertionError: promise resolved "undefined" instead of rejecting

- Expected:
[Error: rejected promise]

+ Received:
undefined

 ❯ tests/billing/credit-admission-policy-pg.test.ts:63:45
     61| it("blocks negative personal balance even when the legacy global prefl…
     62|   await asApp(personal, c => c.query("UPDATE credit_wallets SET balanc…
     63|   await expect(reserve(personal, "negative")).rejects.toMatchObject({c…
       |                                             ^
     64| });
     65| it("admits enterprise debt even when the legacy preflight flag is on",…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/6]⎯

 FAIL  tests/billing/credit-admission-policy-pg.test.ts > admits enterprise debt even when the legacy preflight flag is on
CreditConsumptionError: insufficient_credit
 ❯ PgCreditConsumption.error src/infrastructure/billing/pg-credit-consumption.ts:23:134
     21|   return isLocalOrg(row.kind)?{ownerType:"user",ownerId:userId}:{owner…
     22|  }
     23|  private error(p:Payer,message:string,code:"credit_required"|"credit_a…
       |                                                                                                                                      ^
     24|  async reserveInSession(s:TenantSession,orgId:OrgId,input:Start):Promi…
     25|   const p=await this.payer(s,orgId,input.userId);
 ❯ PgCreditConsumption.reserveInSession src/infrastructure/billing/pg-credit-consumption.ts:53:116
 ❯ PgDatabase.inTx src/infrastructure/db/pg-database.ts:74:19
 ❯ tests/billing/credit-admission-policy-pg.test.ts:68:3

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/6]⎯

 FAIL  tests/billing/credit-admission-policy-pg.test.ts > completes every concurrent request admitted before personal debt becomes visible
CreditConsumptionError: insufficient_credit
 ❯ PgCreditConsumption.error src/infrastructure/billing/pg-credit-consumption.ts:23:134
     21|   return isLocalOrg(row.kind)?{ownerType:"user",ownerId:userId}:{owner…
     22|  }
     23|  private error(p:Payer,message:string,code:"credit_required"|"credit_a…
       |                                                                                                                                      ^
     24|  async reserveInSession(s:TenantSession,orgId:OrgId,input:Start):Promi…
     25|   const p=await this.payer(s,orgId,input.userId);
 ❯ PgCreditConsumption.reserveInSession src/infrastructure/billing/pg-credit-consumption.ts:53:116
 ❯ PgDatabase.inTx src/infrastructure/db/pg-database.ts:74:19
 ❯ tests/billing/credit-admission-policy-pg.test.ts:73:3

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/6]⎯

 FAIL  tests/billing/credit-admission-policy-pg.test.ts > uses the actual balance for availability instead of subtracting an estimated request maximum
AssertionError: expected { ownerType: 'user', …(10) } to match object { balance: 1, …(2) }
(8 matching properties omitted from actual)

- Expected
+ Received

  Object {
-   "availableBalance": 1,
+   "availableBalance": 0,
    "balance": 1,
    "reservedCredits": 1,
  }

 ❯ tests/billing/credit-admission-policy-pg.test.ts:81:44
     79|   await asApp(personal, c => c.query("UPDATE credit_wallets SET balanc…
     80|   await reserve(personal, "estimate");
     81|   expect((await balance(personal)).wallet).toMatchObject({balance: 1, …
       |                                            ^
     82|   await settle(personal, "estimate", 0);
     83| });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/6]⎯

 Test Files  1 failed (1)
      Tests  6 failed (6)
   Start at  03:48:20
   Duration  13.29s (transform 754ms, setup 7ms, collect 1.11s, tests 9.14s, environment 0ms, prepare 34ms)

[db-isolation] db=wsx_e19fda94eef6422303e7 peak_connections=4
undefined
/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: vitest run tests/billing/credit-admission-policy-pg.test.ts
[timing] pnpm --filter @repo/api exec vitest run tests/billing/credit-admission-policy-pg.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：14s
  清理：0s
  总计：14s
