[stack-admission] load1=4.47 cores=10 perCore=0.45 running=0/2
[test-isolation] id=run-mvu3x6s5-c9ac2c4d-69c805e9b0f9 db=wsx_69c805e9b0f99063b930 compose=wsx-69c805e9b0f99063b930 pg=20393 redis=21393 api=24393 web=25393 sandbox=26393 model=27393 deep-agent=28393 asr=29393 vision=30393 loopback-sandbox=31393 mail=19393

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_69c805e9b0f99063b930 capacity=100 current=6 required=32
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
 ✓ tests/billing/stripe-webhook.test.ts (26 tests) 8053ms
 ✓ tests/billing/subscription-credit-backfill.test.ts (4 tests) 289ms

 Test Files  2 passed (2)
      Tests  30 passed (30)
   Start at  06:20:35
   Duration  12.72s (transform 694ms, setup 7ms, collect 1.29s, tests 8.34s, environment 0ms, prepare 61ms)

[db-isolation] db=wsx_69c805e9b0f99063b930 peak_connections=6
[timing] pnpm --filter @repo/api exec vitest run tests/billing/subscription-credit-backfill.test.ts tests/billing/stripe-webhook.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：13s
  清理：0s
  总计：14s
