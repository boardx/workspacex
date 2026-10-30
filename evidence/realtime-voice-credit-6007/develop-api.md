[stack-admission] load1=11.19 cores=10 perCore=1.12 running=1/2
[stack-admission] 排到了，等了 0s
[test-isolation] id=run-mvue9pa3-c6770065-a8ea2a90d27a db=wsx_a8ea2a90d27ab90feec6 compose=wsx-a8ea2a90d27ab90feec6 pg=20608 redis=21608 api=24608 web=25608 sandbox=26608 model=27608 deep-agent=28608 asr=29608 vision=30608 loopback-sandbox=31608 mail=19608

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_a8ea2a90d27ab90feec6 capacity=100 current=6 required=32
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
 ✓ tests/billing/stripe-webhook.test.ts (28 tests) 26660ms
 ✓ tests/billing/subscription-links.test.ts (33 tests) 19015ms
   ✓ F08 real subscription HTTP/PG > rejects unsafe provider response timeout without mutating subscription 8136ms
   ✓ F08 real subscription HTTP/PG > rejects unsafe provider response headers-timeout without mutating subscription 8116ms
 ✓ tests/billing/durable-credit-usage.test.ts (18 tests) 2488ms
   ✓ admits twenty normal concurrent starts without spurious accounting failures 412ms
   ✓ repeated confirmed predispatch credit rejection never consumes spool capacity 1648ms
 ✓ tests/billing/realtime-voice-credit-pg.test.ts (6 tests) 3506ms
   ✓ bills cumulative provider response usage once, completes into debt and blocks a new connection 361ms
   ✓ allows enterprise debt and retains confirmed charges as pending when another response lacks usage 633ms
   ✓ keeps confirmed usage pending after an abrupt drop while a response is still active 459ms
   ✓ settles a confirmed nondispatch and releases its durable slot when the client disconnects during admission 430ms
 ✓ tests/billing/credit-stream-settlement.test.ts (5 tests) 3317ms
   ✓ rounds cumulative stream usage once, ignores stale snapshots, and releases the hold only at completion 428ms
   ✓ recovers cumulative receipts after a database outage without adding per-chunk rounding or another dispatch 324ms

 Test Files  5 passed (5)
      Tests  90 passed (90)
   Start at  11:10:18
   Duration  68.93s (transform 1.85s, setup 57ms, collect 5.17s, tests 54.99s, environment 1ms, prepare 371ms)

[db-isolation] db=wsx_a8ea2a90d27ab90feec6 peak_connections=7
[timing] pnpm --filter @repo/api exec vitest run tests/billing/stripe-webhook.test.ts tests/billing/subscription-links.test.ts tests/billing/realtime-voice-credit-pg.test.ts tests/billing/durable-credit-usage.test.ts tests/billing/credit-stream-settlement.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：1m12s
  清理：2s
  总计：1m14s
