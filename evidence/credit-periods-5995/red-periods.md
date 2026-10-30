[stack-admission] load1=13.24 cores=10 perCore=1.32 running=0/2
[stack-admission] 排到了，等了 0s
[test-isolation] id=run-mvty0lc1-76e56e28-202588e13627 db=wsx_202588e13627f4b982dc compose=wsx-202588e13627f4b982dc pg=20785 redis=21785 api=24785 web=25785 sandbox=26785 model=27785 deep-agent=28785 asr=29785 vision=30785 loopback-sandbox=31785 mail=19785

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_202588e13627f4b982dc capacity=100 current=6 required=32
 ❯ tests/billing/credit-period-lifecycle-pg.test.ts (6 tests | 6 failed) 32499ms
   × grants exactly 20000 once under concurrent repeated payment delivery 65ms
     → subscription credit periods must be persisted: expected null not to be null
   × expires only unused monthly credits once and preserves permanent funds 31ms
     → subscription credit periods must be persisted: expected null not to be null
   × preserves debt through expiry and a partial recharge 68ms
     → subscription credit periods must be persisted: expected null not to be null
   × deduplicates a second invoice for the same subscription period but rejects invoice reassignment 32ms
     → subscription credit periods must be persisted: expected null not to be null
   × does not revive a past paid period or grant an annual period as monthly 34ms
     → subscription credit periods must be persisted: expected null not to be null
   × replays the new migration without changing existing balances or granting again 44ms
     → subscription credit periods must be persisted: expected null not to be null

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/billing/credit-period-lifecycle-pg.test.ts > grants exactly 20000 once under concurrent repeated payment delivery
AssertionError: subscription credit periods must be persisted: expected null not to be null
 ❯ fixture tests/billing/credit-period-lifecycle-pg.test.ts:36:73
     34| async function fixture(suffix: string, permanent = 7) {
     35|   const relation = await asApp(org, async c => (await c.query("SELECT …
     36|   expect(relation, "subscription credit periods must be persisted").no…
       |                                                                         ^
     37|   const helpers = await import("../../src/infrastructure/billing/pg-cr…
     38|   const userId = `${prefix}-${suffix}`;
 ❯ tests/billing/credit-period-lifecycle-pg.test.ts:62:13

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/6]⎯

 FAIL  tests/billing/credit-period-lifecycle-pg.test.ts > expires only unused monthly credits once and preserves permanent funds
AssertionError: subscription credit periods must be persisted: expected null not to be null
 ❯ fixture tests/billing/credit-period-lifecycle-pg.test.ts:36:73
     34| async function fixture(suffix: string, permanent = 7) {
     35|   const relation = await asApp(org, async c => (await c.query("SELECT …
     36|   expect(relation, "subscription credit periods must be persisted").no…
       |                                                                         ^
     37|   const helpers = await import("../../src/infrastructure/billing/pg-cr…
     38|   const userId = `${prefix}-${suffix}`;
 ❯ tests/billing/credit-period-lifecycle-pg.test.ts:67:13

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/6]⎯

 FAIL  tests/billing/credit-period-lifecycle-pg.test.ts > preserves debt through expiry and a partial recharge
AssertionError: subscription credit periods must be persisted: expected null not to be null
 ❯ fixture tests/billing/credit-period-lifecycle-pg.test.ts:36:73
     34| async function fixture(suffix: string, permanent = 7) {
     35|   const relation = await asApp(org, async c => (await c.query("SELECT …
     36|   expect(relation, "subscription credit periods must be persisted").no…
       |                                                                         ^
     37|   const helpers = await import("../../src/infrastructure/billing/pg-cr…
     38|   const userId = `${prefix}-${suffix}`;
 ❯ tests/billing/credit-period-lifecycle-pg.test.ts:75:13

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/6]⎯

 FAIL  tests/billing/credit-period-lifecycle-pg.test.ts > deduplicates a second invoice for the same subscription period but rejects invoice reassignment
AssertionError: subscription credit periods must be persisted: expected null not to be null
 ❯ fixture tests/billing/credit-period-lifecycle-pg.test.ts:36:73
     34| async function fixture(suffix: string, permanent = 7) {
     35|   const relation = await asApp(org, async c => (await c.query("SELECT …
     36|   expect(relation, "subscription credit periods must be persisted").no…
       |                                                                         ^
     37|   const helpers = await import("../../src/infrastructure/billing/pg-cr…
     38|   const userId = `${prefix}-${suffix}`;
 ❯ tests/billing/credit-period-lifecycle-pg.test.ts:83:13

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/6]⎯

 FAIL  tests/billing/credit-period-lifecycle-pg.test.ts > does not revive a past paid period or grant an annual period as monthly
AssertionError: subscription credit periods must be persisted: expected null not to be null
 ❯ fixture tests/billing/credit-period-lifecycle-pg.test.ts:36:73
     34| async function fixture(suffix: string, permanent = 7) {
     35|   const relation = await asApp(org, async c => (await c.query("SELECT …
     36|   expect(relation, "subscription credit periods must be persisted").no…
       |                                                                         ^
     37|   const helpers = await import("../../src/infrastructure/billing/pg-cr…
     38|   const userId = `${prefix}-${suffix}`;
 ❯ tests/billing/credit-period-lifecycle-pg.test.ts:90:13

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/6]⎯

 FAIL  tests/billing/credit-period-lifecycle-pg.test.ts > replays the new migration without changing existing balances or granting again
AssertionError: subscription credit periods must be persisted: expected null not to be null
 ❯ fixture tests/billing/credit-period-lifecycle-pg.test.ts:36:73
     34| async function fixture(suffix: string, permanent = 7) {
     35|   const relation = await asApp(org, async c => (await c.query("SELECT …
     36|   expect(relation, "subscription credit periods must be persisted").no…
       |                                                                         ^
     37|   const helpers = await import("../../src/infrastructure/billing/pg-cr…
     38|   const userId = `${prefix}-${suffix}`;
 ❯ tests/billing/credit-period-lifecycle-pg.test.ts:96:13

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/6]⎯

 Test Files  1 failed (1)
      Tests  6 failed (6)
   Start at  03:35:17
   Duration  41.90s (transform 1.36s, setup 18ms, collect 1.79s, tests 32.50s, environment 0ms, prepare 85ms)

[db-isolation] db=wsx_202588e13627f4b982dc peak_connections=2
undefined
/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: vitest run tests/billing/credit-period-lifecycle-pg.test.ts
[timing] pnpm --filter @repo/api exec vitest run tests/billing/credit-period-lifecycle-pg.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：43s
  清理：2s
  总计：46s
