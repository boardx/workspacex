[stack-admission] load1=3.99 cores=10 perCore=0.40 running=0/2
[test-isolation] id=run-mvtyj43o-b22471b4-bd585493e2a5 db=wsx_bd585493e2a5a24d6225 compose=wsx-bd585493e2a5a24d6225 pg=20643 redis=21643 api=24643 web=25643 sandbox=26643 model=27643 deep-agent=28643 asr=29643 vision=30643 loopback-sandbox=31643 mail=19643

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_bd585493e2a5a24d6225 capacity=100 current=6 required=32
 ❯ tests/billing/credit-stream-settlement.test.ts (3 tests | 3 failed) 7591ms
   × rounds cumulative stream usage once, ignores stale snapshots, and releases the hold only at completion 50ms
     → credit_receipt_replay_mismatch
   × writes the sole token-usage event at stream completion rather than counting every cumulative snapshot 5ms
     → new row for relation "model_request_starts" violates check constraint "model_request_starts_non_run_identity"
   × recovers cumulative receipts after a database outage without adding per-chunk rounding or another dispatch 41ms
     → expected [Function] to throw error including 'offline' but got 'credit_receipt_store_unavailable'

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/billing/credit-stream-settlement.test.ts > rounds cumulative stream usage once, ignores stale snapshots, and releases the hold only at completion
CreditConsumptionError: credit_receipt_replay_mismatch
 ❯ PgCreditConsumption.error src/infrastructure/billing/pg-credit-consumption.ts:23:134
     21|   return isLocalOrg(row.kind)?{ownerType:"user",ownerId:userId}:{owner…
     22|  }
     23|  private error(p:Payer,message:string,code:"credit_required"|"credit_a…
       |                                                                                                                                      ^
     24|  async reserveInSession(s:TenantSession,orgId:OrgId,input:Start):Promi…
     25|   const p=await this.payer(s,orgId,input.userId);
 ❯ PgCreditConsumption.settleInSession src/infrastructure/billing/pg-credit-consumption.ts:73:157
 ❯ PgDatabase.inTx src/infrastructure/db/pg-database.ts:74:19
 ❯ tests/billing/credit-stream-settlement.test.ts:43:3

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL  tests/billing/credit-stream-settlement.test.ts > writes the sole token-usage event at stream completion rather than counting every cumulative snapshot
error: new row for relation "model_request_starts" violates check constraint "model_request_starts_non_run_identity"
 ❯ ../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/client.js:652:17
 ❯ Object.query src/infrastructure/db/pg-database.ts:62:21
     60|         async query<R = Record<string, unknown>>(sql: string, params: …
     61|           assertConnected();
     62|           const r = await client.query(sql, params as unknown[]);
       |                     ^
     63|           assertConnected();
     64|           return { rows: r.rows as R[] } satisfies QueryResult<R>;
 ❯ src/infrastructure/auth/pg-token-usage-repository.ts:31:7
 ❯ PgDatabase.inTx src/infrastructure/db/pg-database.ts:74:19
 ❯ PgTokenUsageRepository.startRequest src/infrastructure/auth/pg-token-usage-repository.ts:29:5
 ❯ tests/billing/credit-stream-settlement.test.ts:59:3

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  tests/billing/credit-stream-settlement.test.ts > recovers cumulative receipts after a database outage without adding per-chunk rounding or another dispatch
AssertionError: expected [Function] to throw error including 'offline' but got 'credit_receipt_store_unavailable'

Expected: "offline"
Received: "credit_receipt_store_unavailable"

 ❯ tests/billing/credit-stream-settlement.test.ts:75:5
     73|     await meter.record(org, receipt("outage", "one", 1));
     74|     offline = true;
     75|     await expect(meter.record(org, receipt("outage", "two", 10))).reje…
       |     ^
     76|     await expect(meter.record(org, receipt("outage", "final", 11, true…
     77|     offline = false;

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯

 Test Files  1 failed (1)
      Tests  3 failed (3)
   Start at  03:49:40
   Duration  11.44s (transform 601ms, setup 5ms, collect 818ms, tests 7.59s, environment 0ms, prepare 45ms)

[db-isolation] db=wsx_bd585493e2a5a24d6225 peak_connections=2
undefined
/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: vitest run tests/billing/credit-stream-settlement.test.ts
[timing] pnpm --filter @repo/api exec vitest run tests/billing/credit-stream-settlement.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：12s
  清理：0s
  总计：12s
