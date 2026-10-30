[stack-admission] load1=9.39 cores=10 perCore=0.94 running=1/2
[stack-admission] 排到了，等了 0s
[test-isolation] id=run-mvuescvu-191afbb7-79ca4ad519e7 db=wsx_79ca4ad519e77dad2283 compose=wsx-79ca4ad519e77dad2283 pg=20565 redis=21565 api=24565 web=25565 sandbox=26565 model=27565 deep-agent=28565 asr=29565 vision=30565 loopback-sandbox=31565 mail=19565

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_79ca4ad519e77dad2283 capacity=100 current=6 required=32
{"level":"error","msg":"billing_stripe_webhook_failed","traceId":"no-trace","detail":{"reason":"synchronization_failed"}}
{"level":"error","msg":"billing_stripe_webhook_failed","traceId":"no-trace","detail":{"reason":"synchronization_failed"}}
{"level":"error","msg":"billing_stripe_webhook_failed","traceId":"no-trace","detail":{"reason":"synchronization_failed"}}
{"level":"error","msg":"billing_stripe_webhook_failed","traceId":"no-trace","detail":{"reason":"synchronization_failed"}}
{"level":"error","msg":"billing_stripe_webhook_failed","traceId":"no-trace","detail":{"reason":"synchronization_failed"}}
{"level":"error","msg":"billing_stripe_webhook_failed","traceId":"no-trace","detail":{"reason":"synchronization_failed"}}
{"level":"error","msg":"billing_stripe_webhook_failed","traceId":"no-trace","detail":{"reason":"synchronization_failed"}}
{"level":"error","msg":"billing_stripe_webhook_failed","traceId":"no-trace","detail":{"reason":"synchronization_failed"}}
{"level":"error","msg":"billing_stripe_webhook_failed","traceId":"no-trace","detail":{"reason":"synchronization_failed"}}
{"level":"error","msg":"billing_stripe_webhook_failed","traceId":"no-trace","detail":{"reason":"synchronization_failed"}}
{"level":"error","msg":"billing_stripe_webhook_failed","traceId":"no-trace","detail":{"reason":"synchronization_failed"}}
{"level":"error","msg":"billing_stripe_webhook_failed","traceId":"no-trace","detail":{"reason":"synchronization_failed"}}
{"level":"error","msg":"billing_stripe_webhook_failed","traceId":"no-trace","detail":{"reason":"synchronization_failed"}}
{"level":"error","msg":"billing_stripe_webhook_failed","traceId":"no-trace","detail":{"reason":"synchronization_failed"}}
{"level":"error","msg":"billing_stripe_webhook_failed","traceId":"no-trace","detail":{"reason":"synchronization_failed"}}
 ✓ tests/billing/stripe-webhook.test.ts (27 tests) 60640ms
   ✓ audits unknown events once with signed public ACK 645ms
   ✓ unknown current state remains retryable and valid recovery clears binding-scoped uncertainty 353ms
   ✓ grants a verified paid monthly invoice exactly once across duplicate and sibling signed events 378ms
   ✓ retries an invoice that arrives before checkout binding instead of permanently ignoring the paid event 327ms
   ✓ preserves paid current credits when auto renewal is canceled and never grants from a failed invoice 452ms
   ✓ can reconcile a previously ignored paid event after enabling monthly credit grants 439ms
   ✓ expires an old unused remainder before renewal and late invoices cannot replace the new subscription period 558ms
   ✓ retired A including unknown state cannot overwrite B or poison its health 425ms
   ✓ a failed provider fetch retries the same event and preserves zero Stripe credit ledger activity 313ms
   ✓ serializes concurrent replay and current snapshots without creating duplicate bindings 577ms
   ✓ a consumed intent cannot bind a second subscription and invoice failure uses authoritative current state 415ms
   ✓ an unknown first verified binding blocks none and repeat purchase until the same subscription recovers 398ms
   ✓ current invalid-items snapshot cannot leave old active confirmed and recovery clears health 305ms
   ✓ period-end cancellation preserves Pro until the authoritative subscription ends 562ms
 ✓ tests/billing/subscription-credit-backfill.test.ts (7 tests) 5823ms
   ✓ dry-run verifies payment without touching balance, then concurrent helper/application and rerun grant once 739ms
   ✓ blocks a no-grant locked reread and recovers the same invoice even after a legacy ok audit 1247ms
 ✓ tests/billing/subscription-credit-checkpoint.test.ts (6 tests) 7ms

 Test Files  3 passed (3)
      Tests  40 passed (40)
   Start at  11:24:47
   Duration  81.70s (transform 3.44s, setup 141ms, collect 6.18s, tests 66.47s, environment 1ms, prepare 615ms)

[db-isolation] db=wsx_79ca4ad519e77dad2283 peak_connections=7
[timing] pnpm --filter @repo/api exec vitest run tests/billing/subscription-credit-backfill.test.ts tests/billing/subscription-credit-checkpoint.test.ts tests/billing/stripe-webhook.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：1m23s
  清理：5s
  总计：1m29s
