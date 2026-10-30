[stack-admission] load1=4.02 cores=10 perCore=0.40 running=1/2
[stack-admission] 排到了，等了 0s
[test-isolation] id=run-mvuduvh5-007a107f-64e8c65f99b4 db=wsx_64e8c65f99b4ac8ef54b compose=wsx-64e8c65f99b4ac8ef54b pg=20735 redis=21735 api=24735 web=25735 sandbox=26735 model=27735 deep-agent=28735 asr=29735 vision=30735 loopback-sandbox=31735 mail=19735

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_64e8c65f99b4ac8ef54b capacity=100 current=6 required=32
[realtime-digital-human] upstream error: {"code":"InvalidApiKey","message":"secret detail"}
 ✓ tests/chat/realtime-digital-human-gateway.test.ts (33 tests) 3574ms
   ✓ WS /chat/realtime-digital-human — Chat 语音模式 > upstream close remains bounded when append never resolves, without a false persisted acknowledgement 2018ms
   ✓ WS /chat/realtime-digital-human — Chat 语音模式 > explicit browser loopback keeps a finite PCM stream actionable and cancels its next chunk 539ms
   ✓ WS /chat/realtime-digital-human — Chat 语音模式 > loopback omni upstream: readable Chinese user + role-aware assistant turn is relayed as live captions, audio and persisted 621ms
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
 ✓ tests/billing/stripe-webhook.test.ts (27 tests) 16090ms
 ✓ tests/billing/subscription-links.test.ts (33 tests) 19171ms
   ✓ F08 real subscription HTTP/PG > rejects unsafe provider response timeout without mutating subscription 8072ms
   ✓ F08 real subscription HTTP/PG > rejects unsafe provider response headers-timeout without mutating subscription 8084ms
   ✓ F08 real subscription HTTP/PG > bounds concurrent abandoned purchases to twenty without invalidating existing links 344ms
 ✓ tests/auth/ai-usage-repository.test.ts (15 tests) 7946ms
   ✓ same ledger reports — isolated PostgreSQL > uses a database-precision default cutoff and clamps a future cutoff to database now 339ms
   ✓ same ledger reports — isolated PostgreSQL > filters member×provider/model intersections and explicit unassigned projects 356ms
   ✓ same ledger reports — isolated PostgreSQL > keyset preserves sub-millisecond timestamp precision and asOf excludes new receipts 526ms
   ✓ same ledger reports — isolated PostgreSQL > preserves microsecond snapshot bounds across report projections 409ms
   ✓ same ledger reports — isolated PostgreSQL > native dimensions keep original units, unknown provenance, and one receipt across report projections 668ms
   ✓ same ledger reports — isolated PostgreSQL > database constraints independently reject fabricated Token/native provenance and ledger mutation 664ms
   ✓ same ledger reports — isolated PostgreSQL > non-run local trials keep null Agent identity, append-only starts and tenant scope 666ms
   ✓ same ledger reports — isolated PostgreSQL > non-run starts cannot erase existing Agent identity requirements or use NULL purpose 628ms
   ✓ same ledger reports — isolated PostgreSQL > ASR personal receipt retains exact active capture owner, null run, tenant fence and terminal idempotence 620ms
   ✓ late original usage enriches one physical call, preserves raw base and historical asOf 647ms
   ✓ reported zero and partial known zero cannot be replaced by contradictory late usage 313ms
   ✓ concurrent late counters merge once per field while contradictory known counters reject 486ms
   ✓ aggregates costs across the full scoped period, separates currencies and keeps unpriced failures 444ms
 ✓ tests/billing/schema-migration.test.ts (16 tests) 2888ms
 ✓ tests/billing/credit-consumption-pg.test.ts (16 tests) 4986ms
   ✓ enterprise requests continue while unknown prior usage awaits authoritative reconciliation 432ms
   ✓ uses actual image-model Tokens before native fallback and holds the larger verified bound 620ms
 ✓ tests/billing/durable-credit-usage.test.ts (18 tests) 3610ms
   ✓ admits twenty normal concurrent starts without spurious accounting failures 452ms
   ✓ repeated confirmed predispatch credit rejection never consumes spool capacity 2661ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"billing_callback_pending","traceId":"14ae27b2-bb0d-4899-99c1-f0d7f119c033","stage":"credit","providerEventId":"f05-4216248d-9afe-4e50-b88b-01844c616ee8","orderNo":"bg20261030025959VSBi5K"}
{"level":"info","msg":"billing_callback_pending","traceId":"f31a9f77-042b-434f-8f19-c4eecbcaf468","stage":"credit","providerEventId":"f05-4216248d-9afe-4e50-b88b-01844c616ee8","orderNo":"bg20261030025959VSBi5K"}
{"level":"info","msg":"billing_callback_pending","traceId":"46ce9b4c-c90c-4a40-9c74-17eaf4c62283","stage":"credit","providerEventId":"f05-4216248d-9afe-4e50-b88b-01844c616ee8","orderNo":"bg20261030025959VSBi5K"}
{"level":"info","msg":"billing_callback_pending","traceId":"e22af8d3-c05c-4d27-9de3-6bde96fb854a","stage":"credit","providerEventId":"f05-4216248d-9afe-4e50-b88b-01844c616ee8","orderNo":"bg20261030025959VSBi5K"}
{"level":"info","msg":"billing_callback_pending","traceId":"c9e5516b-73be-41b3-98e2-33bd86b1c902","stage":"credit","providerEventId":"f05-4216248d-9afe-4e50-b88b-01844c616ee8","orderNo":"bg20261030025959VSBi5K"}
{"level":"error","msg":"billing_callback_failed","traceId":"18dbaa97-4ce2-4a00-b7e5-da8e47eaf236","detail":{"stage":"accept","code":"23505","providerEventId":"f05-5eade1f9-2967-4dc2-851b-a7a388d008c5","orderNo":"bg202610300300017QNXhA"}}
{"level":"info","msg":"billing_late_paid_order","traceId":"f05-cfdf71b0-9214-4a77-896d-149bdcce96a0","orderNo":"bg202610300300019jsvOD"}
{"level":"info","msg":"database_connection_error","traceId":"database","code":"unknown"}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-573663cd-ce33-42e1-b768-620425336644","detail":{"providerEventId":"f05-573663cd-ce33-42e1-b768-620425336644","code":"57P01"}}
{"level":"info","msg":"billing_callback_pending","traceId":"be56354f-9ad1-4ba1-9194-c9141820ea14","stage":"credit","providerEventId":"f05-573663cd-ce33-42e1-b768-620425336644","orderNo":"bg20261030030001UbwxhO"}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-ad6cac30-3285-45b1-a2bb-a98f3446bbd8","detail":{"providerEventId":"f05-ad6cac30-3285-45b1-a2bb-a98f3446bbd8","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-6c0f3cf7-23f7-405c-9ddc-71cb925532d3","detail":{"providerEventId":"f05-6c0f3cf7-23f7-405c-9ddc-71cb925532d3","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-6f8fd661-a00c-4cae-85cc-5f0856e19a82","detail":{"providerEventId":"f05-6f8fd661-a00c-4cae-85cc-5f0856e19a82","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-d6768406-19be-4745-84ab-dd1d8962dfce","detail":{"providerEventId":"f05-d6768406-19be-4745-84ab-dd1d8962dfce","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-73e7cd90-a8d4-40b8-b2a9-367073e246c3","detail":{"providerEventId":"f05-73e7cd90-a8d4-40b8-b2a9-367073e246c3","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-14cf394c-85c7-4dad-83df-2a146c87683b","detail":{"providerEventId":"f05-14cf394c-85c7-4dad-83df-2a146c87683b","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-35c34474-a6bd-400f-a3ca-d2df41132fbb","detail":{"providerEventId":"f05-35c34474-a6bd-400f-a3ca-d2df41132fbb","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-7b60b18d-923d-4b36-8e01-3a99d6105d4e","detail":{"providerEventId":"f05-7b60b18d-923d-4b36-8e01-3a99d6105d4e","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-3bf98a0f-d292-4213-a341-d689674dfb83","detail":{"providerEventId":"f05-3bf98a0f-d292-4213-a341-d689674dfb83","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-7f2086d5-aa3d-4e16-af12-3e7e31342c97","detail":{"providerEventId":"f05-7f2086d5-aa3d-4e16-af12-3e7e31342c97","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-ad6cac30-3285-45b1-a2bb-a98f3446bbd8","detail":{"providerEventId":"f05-ad6cac30-3285-45b1-a2bb-a98f3446bbd8","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-6c0f3cf7-23f7-405c-9ddc-71cb925532d3","detail":{"providerEventId":"f05-6c0f3cf7-23f7-405c-9ddc-71cb925532d3","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-6f8fd661-a00c-4cae-85cc-5f0856e19a82","detail":{"providerEventId":"f05-6f8fd661-a00c-4cae-85cc-5f0856e19a82","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-d6768406-19be-4745-84ab-dd1d8962dfce","detail":{"providerEventId":"f05-d6768406-19be-4745-84ab-dd1d8962dfce","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-73e7cd90-a8d4-40b8-b2a9-367073e246c3","detail":{"providerEventId":"f05-73e7cd90-a8d4-40b8-b2a9-367073e246c3","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-14cf394c-85c7-4dad-83df-2a146c87683b","detail":{"providerEventId":"f05-14cf394c-85c7-4dad-83df-2a146c87683b","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-35c34474-a6bd-400f-a3ca-d2df41132fbb","detail":{"providerEventId":"f05-35c34474-a6bd-400f-a3ca-d2df41132fbb","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-7b60b18d-923d-4b36-8e01-3a99d6105d4e","detail":{"providerEventId":"f05-7b60b18d-923d-4b36-8e01-3a99d6105d4e","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-3bf98a0f-d292-4213-a341-d689674dfb83","detail":{"providerEventId":"f05-3bf98a0f-d292-4213-a341-d689674dfb83","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-7f2086d5-aa3d-4e16-af12-3e7e31342c97","detail":{"providerEventId":"f05-7f2086d5-aa3d-4e16-af12-3e7e31342c97","code":"event_conflict"}}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-4b770a1a-6063-47c9-b5e8-e60035fb89d6","orderNo":"bg202610300300119oGlrd","reason":"wallet_limit"}
 ✓ tests/billing/wechat-notify-crediting.test.ts (11 tests) 13985ms
   ✓ F05 durable idempotent PostgreSQL crediting > credits once under duplicate and distinct concurrent provider events for one order 500ms
   ✓ F05 durable idempotent PostgreSQL crediting > does not reuse an event id for a different receipt or order 438ms
   ✓ F05 durable idempotent PostgreSQL crediting > recovers a connection crash before commit from a durable receipt after a new app/pool starts 8591ms
   ✓ F05 durable idempotent PostgreSQL crediting > does not double credit when the committed success ACK is lost on the network 305ms
   ✓ F05 durable idempotent PostgreSQL crediting > does not let ten conflicting receipts starve a later valid crash-recovery receipt 1025ms
 ✓ tests/chat/realtime-voice-session.test.ts (14 tests) 17ms
stdout | tests/billing/wallet-ledger-query.test.ts
[F03 HTTP fixture] starting database readiness

stdout | tests/billing/wallet-ledger-query.test.ts
[F03 HTTP fixture] database ready; creating Nest fixture
[F03 HTTP fixture] Nest created; binding loopback listener
[F03 HTTP fixture] listener ready

 ✓ tests/billing/wallet-ledger-query.test.ts (9 tests) 1621ms
{"level":"info","msg":"billing_orders_expired","traceId":"billing-order-expiry:f508dab1-e2c9-48d7-a2a9-9b57d7d55339","closedCount":1}
{"level":"error","msg":"billing_order_expiry_failed","traceId":"billing-order-expiry:0d7886ce-af19-4e29-9f74-6bbfc9c1d5f5","detail":{"stage":"expiry_sweep","code":"other"}}
{"level":"info","msg":"billing_orders_expired","traceId":"billing-order-expiry:95bf7c67-4c26-46af-8dd6-cf8e9cfadfdb","closedCount":2}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"billing_late_paid_order","traceId":"f05-79425ef7-83d5-42c0-9404-342a22ef7726","orderNo":"bg202610160000007625b8"}
{"level":"info","msg":"billing_late_paid_order","traceId":"f05-7fb06a70-49f7-49da-9b4c-91b7c578dd13","orderNo":"bg202610160000004d8bfa"}
 ✓ tests/billing/order-close-task.test.ts (10 tests) 2452ms
   ✓ F07 actual PostgreSQL expiry and payment races > closes only expired PENDING snapshots, stamps closure once and exposes CLOSED through the real API 438ms
 ✓ tests/billing/realtime-voice-credit-pg.test.ts (6 tests) 2932ms
   ✓ bills cumulative provider response usage once, completes into debt and blocks a new connection 606ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"instance telemetry disabled (endpoint_unset)","traceId":"instance-telemetry"}
{"level":"info","msg":"dev-process projection sync disabled (WSX_DEV_PROJECTION_SYNC_ORG unset)","traceId":"dev-process-projection-sync"}
{"level":"info","msg":"kg embedding worker not started: no embedding model configured; memory recall uses text + graph only","traceId":"kg-embedding","code":"embedding_not_configured"}
{"level":"error","msg":"http exception","traceId":"6701463c-2591-4689-8a31-c14baec79bec","detail":{"name":"UnauthorizedException","message":"unauthenticated","stack":"UnauthorizedException: unauthenticated\n    at PrincipalGuard.canActivate (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/guards/principal.guard.ts:54:27)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
 ✓ tests/billing/billing-config.test.ts (21 tests) 28447ms
 ✓ tests/billing/credit-model-pg.integration.test.ts (4 tests) 3048ms
 ✓ tests/billing/credit-stream-settlement.test.ts (5 tests) 1239ms
 ✓ tests/chat/realtime-voice-transcript-real-db.test.ts (4 tests) 2141ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"http exception","traceId":"4b2b8f80-8676-431e-9bf7-3274f2e25f50","detail":{"name":"UnauthorizedException","message":"unauthenticated","stack":"UnauthorizedException: unauthenticated\n    at PrincipalGuard.canActivate (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/guards/principal.guard.ts:54:27)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"contract validation failed","traceId":"01982178-f35b-4bce-8cce-c6319b438401","detail":{"name":"ContractValidationError","message":"validation_failed","stack":"ContractValidationError: validation_failed\n    at ZodBodyPipe.transform (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/pipes/zod-body.pipe.ts:41:11)\n    at /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/node_modules/.pnpm/@nestjs+core@10.4.22_@nestjs+common@10.4.22_class-transformer@0.5.1_class-validator@0.14.4_re_sgffei4zmw63aa4v2dkhbu25m4/node_modules/@nestjs/core/pipes/pipes-consumer.js:16:33\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"8b374908-2229-428d-934f-6ce1c9245f6a","detail":{"stage":"http","reason":"upstream_http_error","status":500,"orderNo":"bg20261030030107Zd8RI5"}}
{"level":"error","msg":"http exception","traceId":"8b374908-2229-428d-934f-6ce1c9245f6a","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"a83baba0-a073-429a-aec3-9ae0a3f1beae","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg202610300301076kjQ4G"}}
{"level":"error","msg":"http exception","traceId":"a83baba0-a073-429a-aec3-9ae0a3f1beae","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"8f6d012a-c216-45bb-b36a-f99641dce1d4","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030030107u5Xm7K"}}
{"level":"error","msg":"http exception","traceId":"8f6d012a-c216-45bb-b36a-f99641dce1d4","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"d737e91b-f19c-43a3-8366-5eab7e0122c3","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030030107yBiNmI"}}
{"level":"error","msg":"http exception","traceId":"d737e91b-f19c-43a3-8366-5eab7e0122c3","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"86c629a0-9a9f-4964-b7ca-74a545abae95","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030030107Ts0M7M"}}
{"level":"error","msg":"http exception","traceId":"86c629a0-9a9f-4964-b7ca-74a545abae95","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"4f23a821-48e2-4094-bbd5-b135bdeffd16","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030030108lKHDqq"}}
{"level":"error","msg":"http exception","traceId":"4f23a821-48e2-4094-bbd5-b135bdeffd16","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"6bf9ef29-a911-4608-a3db-d6239bdc103c","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030030108oSIn82"}}
{"level":"error","msg":"http exception","traceId":"6bf9ef29-a911-4608-a3db-d6239bdc103c","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"3003b345-7da5-4da0-bf12-ab2be8307ad9","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030030108LHgw6K"}}
{"level":"error","msg":"http exception","traceId":"3003b345-7da5-4da0-bf12-ab2be8307ad9","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"e43ea9e5-3496-4c36-a8ab-16ed164000bf","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030030108EPAjqM"}}
{"level":"error","msg":"http exception","traceId":"e43ea9e5-3496-4c36-a8ab-16ed164000bf","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"9e172973-53b3-44eb-ae9d-b4487f8545ef","detail":{"stage":"qr","reason":"response_qr_invalid","status":200,"orderNo":"bg20261030030109RODr4m"}}
{"level":"error","msg":"http exception","traceId":"9e172973-53b3-44eb-ae9d-b4487f8545ef","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"ba8054e9-e91b-43c9-83a7-45826a8aff3a","detail":{"stage":"qr","reason":"response_qr_invalid","status":200,"orderNo":"bg20261030030109a2EZ1L"}}
{"level":"error","msg":"http exception","traceId":"ba8054e9-e91b-43c9-83a7-45826a8aff3a","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"de65ab61-87a3-4f02-8db0-d6b2da4bc725","detail":{"stage":"json","reason":"response_json_invalid","status":200,"orderNo":"bg20261030030109OWjH0h"}}
{"level":"error","msg":"http exception","traceId":"de65ab61-87a3-4f02-8db0-d6b2da4bc725","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"70d63846-1614-41a6-a8dc-f11d5920c0c3","detail":{"stage":"request","reason":"request_failed","orderNo":"bg20261030030109ghtO5J"}}
{"level":"error","msg":"http exception","traceId":"70d63846-1614-41a6-a8dc-f11d5920c0c3","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"841cd547-36bf-42c2-9d63-defc0d9d8fa0","detail":{"stage":"body","reason":"response_body_invalid","status":200,"orderNo":"bg20261030030110xyhyXH"}}
{"level":"error","msg":"http exception","traceId":"841cd547-36bf-42c2-9d63-defc0d9d8fa0","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_native_failed","traceId":"c391453c-5c56-4ae5-9d27-0bdd2ad49899","detail":{"stage":"request","reason":"request_timeout","orderNo":"bg20261030030110fYWnbB"}}
{"level":"error","msg":"http exception","traceId":"c391453c-5c56-4ae5-9d27-0bdd2ad49899","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_native_failed","traceId":"1ded3966-7bcc-428f-b877-1d3c5be907f7","detail":{"stage":"body","reason":"request_timeout","status":200,"orderNo":"bg20261030030118eZ6Q9K"}}
{"level":"error","msg":"http exception","traceId":"1ded3966-7bcc-428f-b877-1d3c5be907f7","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"http exception","traceId":"8a5edf14-83a6-4e6f-9271-54c3345a0650","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"unhandled exception","traceId":"6169e7ce-e8ad-4477-b017-77689b518a9f","detail":{"name":"error","message":"insert or update on table \"billing_orders\" violates foreign key constraint \"billing_orders_package_id_fkey\"","stack":"error: insert or update on table \"billing_orders\" violates foreign key constraint \"billing_orders_package_id_fkey\"\n    at /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/client.js:652:17\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)\n    at Object.query (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/infrastructure/db/pg-database.ts:62:21)\n    at /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/infrastructure/billing/pg-billing-order-repository.ts:37:22\n    at PgDatabase.inTx (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/infrastructure/db/pg-database.ts:74:19)\n    at BillingOrderService.create (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/application/billing/billing-order-service.ts:80:61)\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:14:18)"}}
{"level":"error","msg":"http exception","traceId":"2b8048c4-2359-4868-b6bc-e3bc09a0b7bf","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"aa471028-4507-439c-9423-259187b86165","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"54fafdb9-7308-45f0-bb33-f2b0d96dddc6","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
 ✓ tests/billing/order-core.test.ts (26 tests) 23366ms
   ✓ F04 real Native order HTTP and PostgreSQL > does not persist a fake order on missing-time 338ms
   ✓ F04 real Native order HTTP and PostgreSQL > does not persist a fake order on malformed 549ms
   ✓ F04 real Native order HTTP and PostgreSQL > does not persist a fake order on timeout-headers 8295ms
   ✓ F04 real Native order HTTP and PostgreSQL > does not persist a fake order on timeout-body 8358ms
   ✓ F04 real Native order HTTP and PostgreSQL > reads an expired order without closing it and preserves reads after billing is disabled 366ms
 ✓ tests/billing/credit-period-lifecycle-pg.test.ts (6 tests) 2682ms
 ✓ tests/billing/private-auxiliary-credit-pg.test.ts (5 tests) 1248ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"billing_late_paid_order","traceId":"f05-734f2e77-6fba-4661-8538-a2968534d261","orderNo":"bg20261030030138n1PEVU"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-5e286f1c-6042-47d5-b89e-a8fbf38780f8","orderNo":"bg202610300301384QWZ3h","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-a13cf3ae-9820-48a6-be84-4580bdcd7afc","orderNo":"bg202610300301381h5XN5","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-d7b0b91a-0bcb-4099-8bd9-949d773c3c3f","orderNo":"bg20261030030139pQEog9","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-badb5cd8-2b8d-4163-b5c3-75c0f2b8eb7a","orderNo":"bg20261030030139duGOS5","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-2877f97e-d305-4e96-a525-653c4c6c9af8","orderNo":"bg202610300301404mfsKq","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-5c2bbea7-ad5d-4ad4-ad22-b25bcc3270ae","orderNo":"bg20261030030140qblP7g","reason":"wallet_limit"}
 ✓ tests/billing/wechat-notify-outcomes.test.ts (8 tests) 5254ms
   ✓ F05 terminal timestamps and durable paid-funds recovery > keeps acceptance timestamps null for CLOSED until successful crediting 856ms
   ✓ F05 terminal timestamps and durable paid-funds recovery > durably records PENDING paid funds exceeding balance capacity without partial credit 301ms
   ✓ F05 terminal timestamps and durable paid-funds recovery > durably records CLOSED paid funds exceeding balance capacity without partial credit 750ms
   ✓ F05 terminal timestamps and durable paid-funds recovery > durably records CLOSED paid funds exceeding purchased capacity without partial credit 441ms
   ✓ F05 terminal timestamps and durable paid-funds recovery > keeps PENDING manual recovery authoritative when a distinct event arrives after capacity is released 301ms
 ✓ tests/billing/subscription-credit-backfill.test.ts (6 tests) 2184ms
   ✓ never fills an unpaid or historic invoice as the current entitlement 397ms
   ✓ blocks unresolved bindings even with an absent/terminal subscription snapshot (false) 585ms
 ✓ tests/billing/credit-model-gateway.test.ts (10 tests) 14ms
 ✓ tests/billing/credit-admission-policy-pg.test.ts (6 tests) 2350ms
 ✓ tests/billing/personal-credit-usage.test.ts (3 tests) 1332ms
 ✓ tests/billing/consumption-settings.test.ts (4 tests) 191ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
 ✓ tests/billing/wechat-notify-verify.test.ts (13 tests) 4064ms
   ✓ F05 raw WeChat callback cryptographic boundary > rejects stale before crediting, without poisoning the real event id 313ms
   ✓ F05 raw WeChat callback cryptographic boundary > rejects unknown-key before crediting, without poisoning the real event id 387ms
   ✓ F05 raw WeChat callback cryptographic boundary > rejects wrong-rsa before crediting, without poisoning the real event id 372ms
   ✓ F05 raw WeChat callback cryptographic boundary > rejects a signed receipt inconsistent with merchant or order: {"appid":"other-app"} 450ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"http exception","traceId":"b019d892-7835-4a66-acd9-88c76695f186","detail":{"name":"UnauthorizedException","message":"unauthenticated","stack":"UnauthorizedException: unauthenticated\n    at PrincipalGuard.canActivate (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/guards/principal.guard.ts:54:27)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"da1bc8fe-d9c7-4a3f-865c-efd9f8d14d1a","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"95119b14-610a-4fa7-a81d-3bb004f85884","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_close_failed","traceId":"549c207b-6590-4191-8268-42c1da920c77","detail":{"orderNo":"bg20261030030200cD8dP7","reason":"merchant_closure_unconfirmed"}}
{"level":"error","msg":"http exception","traceId":"549c207b-6590-4191-8268-42c1da920c77","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_close_failed","traceId":"01f9bb86-ff94-492d-ad3c-2618d872538c","detail":{"orderNo":"bg20261030030200hycrPf","reason":"merchant_closure_unconfirmed"}}
{"level":"error","msg":"http exception","traceId":"01f9bb86-ff94-492d-ad3c-2618d872538c","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"d6d291e6-1cc4-4819-a2b6-3e48e5df9d63","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"ac5c6c1c-9e40-43bd-9453-6e8421396665","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
 ✓ tests/billing/order-cancel.test.ts (8 tests) 3300ms
   ✓ authenticated unpaid order cancellation > rejects unauthenticated and foreign callers before contacting WeChat 687ms
   ✓ authenticated unpaid order cancellation > preserves the order on merchant paid 459ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"http exception","traceId":"c34b349e-61c1-4176-86be-bd808ec866d9","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"contract validation failed","traceId":"5fad46f8-5033-4391-a32d-82d58cc679e2","detail":{"name":"ContractValidationError","message":"validation_failed","stack":"ContractValidationError: validation_failed\n    at ZodBodyPipe.transform (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/pipes/zod-body.pipe.ts:41:11)\n    at /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/node_modules/.pnpm/@nestjs+core@10.4.22_@nestjs+common@10.4.22_class-transformer@0.5.1_class-validator@0.14.4_re_sgffei4zmw63aa4v2dkhbu25m4/node_modules/@nestjs/core/pipes/pipes-consumer.js:16:33\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"c01861fd-a1ee-4e3b-a428-6e7bfc11be5e","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"330abfc6-d764-4a13-ba6e-cf8ff1ea29b6","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"83df83a0-9ffa-45b5-82ae-668f9d37b18b","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"7ead353f-0faf-45d9-898f-41e13b8b51b3","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"68a6ecdf-be80-4f96-a044-4104de54f38d","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"acd34a67-5159-4b6e-8bfc-de17d40a39d9","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
 ✓ tests/billing/order-ownership.test.ts (6 tests) 4254ms
   ✓ F04 HTTP order ownership with persisted memberships > does not turn platform authority into permission to charge an organization 363ms
   ✓ F04 HTTP order ownership with persisted memberships > keeps user and team orders distinct when their owner identifier is identical 374ms
 ✓ tests/billing/wechat-notify-observability.test.ts (4 tests) 6ms
 ✓ tests/billing/native-credit-tariff-pg.test.ts (3 tests) 2934ms
 ✓ tests/billing/chat-read-asr-credit-fixture.test.ts (2 tests) 1445ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
 ✓ tests/billing/wechat-reference-compatibility.test.ts (5 tests) 3849ms
   ✓ reference backend WeChat compatibility > signs Native requests without a platform key and credits unsigned callbacks exactly once 400ms
   ✓ reference backend WeChat compatibility > still rejects failed AES-GCM authentication without crediting 428ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_native_failed","traceId":"8a369a90-1356-4d93-aab4-022f5abdc91c","detail":{"stage":"json","reason":"response_json_invalid","status":200,"orderNo":"bg20261030030222xHKf4n"}}
{"level":"error","msg":"http exception","traceId":"8a369a90-1356-4d93-aab4-022f5abdc91c","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"native-safe-trace","detail":{"stage":"http","reason":"upstream_http_error","status":500,"orderNo":"bg20261030030222PDgv7O"}}
{"level":"error","msg":"billing_native_failed","traceId":"native-safe-trace","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030030222oDl6A9"}}
{"level":"error","msg":"billing_native_failed","traceId":"native-safe-trace","detail":{"stage":"json","reason":"response_json_invalid","status":200,"orderNo":"bg202610300302225Cj7eR"}}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_native_failed","traceId":"native-safe-trace","detail":{"stage":"request","reason":"request_timeout","orderNo":"bg20261030030222U3nfdK"}}
 ✓ tests/billing/native-failure-diagnostics.test.ts (5 tests) 10282ms
   ✓ Native merchant failure diagnostics > retains safe timeout-headers cause and trace without signed bodies or credentials 8230ms
 ✓ tests/billing/native-read-deadline.test.ts (2 tests) 25ms
 ✓ tests/billing/consumption-settings-pg.test.ts (2 tests) 701ms
 ✓ tests/auth/ai-usage-scope.test.ts (4 tests) 11ms
 ✓ tests/billing/credit-error-boundary.test.ts (3 tests) 12ms
 ✓ tests/billing/reference-package-catalog.test.ts (2 tests) 1045ms
 ✓ tests/billing/credit-periods-pg.test.ts (1 test) 4513ms
 ✓ tests/billing/global-error-boundary.test.ts (4 tests) 14ms
 ✓ tests/billing/credit-execution-context.test.ts (2 tests) 15ms
 ✓ tests/billing/private-credit-failure.test.ts (3 tests) 58ms
 ✓ tests/billing/credit-auxiliary-errors.test.ts (3 tests) 7ms
 ✓ tests/billing/billing-global-boundary.test.ts (9 tests) 59ms
 ✓ tests/billing/credit-run-error-contract.test.ts (1 test) 734ms

 Test Files  45 passed (45)
      Tests  398 passed (398)
   Start at  10:58:43
   Duration  246.86s (transform 17.54s, setup 575ms, collect 38.14s, tests 190.10s, environment 10ms, prepare 4.30s)

[db-isolation] db=wsx_64e8c65f99b4ac8ef54b peak_connections=10
[timing] pnpm --filter @repo/api exec vitest run tests/billing tests/auth/ai-usage-repository.test.ts tests/auth/ai-usage-scope.test.ts tests/chat/realtime-digital-human-gateway.test.ts tests/chat/realtime-voice-session.test.ts tests/chat/realtime-voice-transcript-real-db.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：4m8s
  清理：1s
  总计：4m9s
