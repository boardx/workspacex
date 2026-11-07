[stack-admission] load1=20.52 cores=10 perCore=2.05 running=1/2
[stack-admission] 排到了，等了 0s
[test-isolation] id=run-mvuf2b7x-e0562b98-866dc020a6fa db=wsx_866dc020a6fad1513850 compose=wsx-866dc020a6fad1513850 pg=20552 redis=21552 api=24552 web=25552 sandbox=26552 model=27552 deep-agent=28552 asr=29552 vision=30552 loopback-sandbox=31552 mail=19552

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_866dc020a6fad1513850 capacity=100 current=6 required=32
[realtime-digital-human] upstream error: {"code":"InvalidApiKey","message":"secret detail"}
 ✓ tests/chat/realtime-digital-human-gateway.test.ts (33 tests) 4587ms
   ✓ WS /chat/realtime-digital-human — Chat 语音模式 > upstream close remains bounded when append never resolves, without a false persisted acknowledgement 2029ms
   ✓ WS /chat/realtime-digital-human — Chat 语音模式 > explicit browser loopback keeps a finite PCM stream actionable and cancels its next chunk 935ms
   ✓ WS /chat/realtime-digital-human — Chat 语音模式 > loopback omni upstream: readable Chinese user + role-aware assistant turn is relayed as live captions, audio and persisted 708ms
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
 ✓ tests/billing/stripe-webhook.test.ts (28 tests) 64766ms
   ✓ grants a verified paid monthly invoice exactly once across duplicate and sibling signed events 581ms
   ✓ retries an invoice that arrives before checkout binding instead of permanently ignoring the paid event 643ms
   ✓ expires an old unused remainder before renewal and late invoices cannot replace the new subscription period 326ms
 ✓ tests/billing/subscription-links.test.ts (33 tests) 20590ms
   ✓ F08 real subscription HTTP/PG > rejects unsafe provider response timeout without mutating subscription 8118ms
   ✓ F08 real subscription HTTP/PG > rejects unsafe provider response headers-timeout without mutating subscription 8111ms
 ✓ tests/auth/ai-usage-repository.test.ts (15 tests) 13302ms
   ✓ same ledger reports — isolated PostgreSQL > preserves the microsecond snapshot boundary across summary and call pagination 684ms
   ✓ same ledger reports — isolated PostgreSQL > uses a database-precision default cutoff and clamps a future cutoff to database now 952ms
   ✓ same ledger reports — isolated PostgreSQL > summary, member/model/project and details have matching totals and explicit unknown coverage 1127ms
   ✓ same ledger reports — isolated PostgreSQL > filters member×provider/model intersections and explicit unassigned projects 885ms
   ✓ same ledger reports — isolated PostgreSQL > keyset preserves sub-millisecond timestamp precision and asOf excludes new receipts 945ms
   ✓ same ledger reports — isolated PostgreSQL > preserves microsecond snapshot bounds across report projections 705ms
   ✓ same ledger reports — isolated PostgreSQL > native dimensions keep original units, unknown provenance, and one receipt across report projections 1028ms
   ✓ same ledger reports — isolated PostgreSQL > database constraints independently reject fabricated Token/native provenance and ledger mutation 737ms
   ✓ same ledger reports — isolated PostgreSQL > non-run local trials keep null Agent identity, append-only starts and tenant scope 478ms
   ✓ same ledger reports — isolated PostgreSQL > non-run starts cannot erase existing Agent identity requirements or use NULL purpose 440ms
   ✓ same ledger reports — isolated PostgreSQL > ASR personal receipt retains exact active capture owner, null run, tenant fence and terminal idempotence 623ms
   ✓ late original usage enriches one physical call, preserves raw base and historical asOf 1072ms
   ✓ reported zero and partial known zero cannot be replaced by contradictory late usage 1073ms
   ✓ concurrent late counters merge once per field while contradictory known counters reject 864ms
   ✓ aggregates costs across the full scoped period, separates currencies and keeps unpriced failures 676ms
 ✓ tests/billing/schema-migration.test.ts (16 tests) 3142ms
 ✓ tests/billing/credit-consumption-pg.test.ts (16 tests) 3414ms
 ✓ tests/billing/durable-credit-usage.test.ts (18 tests) 3193ms
   ✓ admits twenty normal concurrent starts without spurious accounting failures 424ms
   ✓ repeated confirmed predispatch credit rejection never consumes spool capacity 2225ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"billing_callback_pending","traceId":"4b07d3a7-e1fb-4062-8b74-dc693695db30","stage":"credit","providerEventId":"f05-aa0bd58e-6344-46ef-b70c-4d16f53803d4","orderNo":"bg20261030033508g4xRZX"}
{"level":"info","msg":"billing_callback_pending","traceId":"9277c5f6-47c7-4110-b319-28d7227f308f","stage":"credit","providerEventId":"f05-aa0bd58e-6344-46ef-b70c-4d16f53803d4","orderNo":"bg20261030033508g4xRZX"}
{"level":"info","msg":"billing_callback_pending","traceId":"093d7923-2b57-4486-b116-e6d6623c175e","stage":"credit","providerEventId":"f05-aa0bd58e-6344-46ef-b70c-4d16f53803d4","orderNo":"bg20261030033508g4xRZX"}
{"level":"info","msg":"billing_callback_pending","traceId":"3d525196-12f9-4517-899d-8158463b626c","stage":"credit","providerEventId":"f05-aa0bd58e-6344-46ef-b70c-4d16f53803d4","orderNo":"bg20261030033508g4xRZX"}
{"level":"info","msg":"billing_callback_pending","traceId":"8a4253e9-ba96-41e5-bcde-ba943230c9de","stage":"credit","providerEventId":"f05-aa0bd58e-6344-46ef-b70c-4d16f53803d4","orderNo":"bg20261030033508g4xRZX"}
{"level":"error","msg":"billing_callback_failed","traceId":"c2cfe31d-0d37-4a51-bac5-790ac638d593","detail":{"stage":"accept","code":"23505","providerEventId":"f05-d619b8f7-70f3-4ccc-a50a-e31dd9a74f49","orderNo":"bg20261030033509wglouk"}}
{"level":"info","msg":"billing_late_paid_order","traceId":"f05-07204197-f6fd-4197-b158-38c1d6cde6fe","orderNo":"bg20261030033509mvS3BV"}
{"level":"info","msg":"database_connection_error","traceId":"database","code":"unknown"}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-3ae19683-998b-447a-ae9c-50089f7f165d","detail":{"providerEventId":"f05-3ae19683-998b-447a-ae9c-50089f7f165d","code":"57P01"}}
{"level":"info","msg":"billing_callback_pending","traceId":"60c8d917-3aff-4bbe-befd-284840b99aac","stage":"credit","providerEventId":"f05-3ae19683-998b-447a-ae9c-50089f7f165d","orderNo":"bg20261030033510IfuKNT"}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-ac776753-b66d-4653-b633-dd809c020d95","detail":{"providerEventId":"f05-ac776753-b66d-4653-b633-dd809c020d95","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-21d8af93-4fa1-49e2-8333-e183aa54953a","detail":{"providerEventId":"f05-21d8af93-4fa1-49e2-8333-e183aa54953a","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-ac65e610-a6ed-4bfa-8bff-7149175fa12a","detail":{"providerEventId":"f05-ac65e610-a6ed-4bfa-8bff-7149175fa12a","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-294678f9-7a38-443c-9ef7-9a41c7892ba8","detail":{"providerEventId":"f05-294678f9-7a38-443c-9ef7-9a41c7892ba8","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-86f3e06a-2721-42c0-899a-cf648b23cc33","detail":{"providerEventId":"f05-86f3e06a-2721-42c0-899a-cf648b23cc33","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-c46941d4-8ca0-444e-9e9b-402e949fc862","detail":{"providerEventId":"f05-c46941d4-8ca0-444e-9e9b-402e949fc862","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-d58eed80-676e-4843-a767-f11541439f58","detail":{"providerEventId":"f05-d58eed80-676e-4843-a767-f11541439f58","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-3fd4289b-6940-466f-9b3a-b86d72811a95","detail":{"providerEventId":"f05-3fd4289b-6940-466f-9b3a-b86d72811a95","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-997cf1d2-221f-4514-bd92-308c3bf4bba9","detail":{"providerEventId":"f05-997cf1d2-221f-4514-bd92-308c3bf4bba9","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-8dff7588-c4b4-4171-8f27-a8707892fb6e","detail":{"providerEventId":"f05-8dff7588-c4b4-4171-8f27-a8707892fb6e","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-ac776753-b66d-4653-b633-dd809c020d95","detail":{"providerEventId":"f05-ac776753-b66d-4653-b633-dd809c020d95","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-21d8af93-4fa1-49e2-8333-e183aa54953a","detail":{"providerEventId":"f05-21d8af93-4fa1-49e2-8333-e183aa54953a","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-ac65e610-a6ed-4bfa-8bff-7149175fa12a","detail":{"providerEventId":"f05-ac65e610-a6ed-4bfa-8bff-7149175fa12a","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-294678f9-7a38-443c-9ef7-9a41c7892ba8","detail":{"providerEventId":"f05-294678f9-7a38-443c-9ef7-9a41c7892ba8","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-86f3e06a-2721-42c0-899a-cf648b23cc33","detail":{"providerEventId":"f05-86f3e06a-2721-42c0-899a-cf648b23cc33","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-c46941d4-8ca0-444e-9e9b-402e949fc862","detail":{"providerEventId":"f05-c46941d4-8ca0-444e-9e9b-402e949fc862","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-d58eed80-676e-4843-a767-f11541439f58","detail":{"providerEventId":"f05-d58eed80-676e-4843-a767-f11541439f58","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-3fd4289b-6940-466f-9b3a-b86d72811a95","detail":{"providerEventId":"f05-3fd4289b-6940-466f-9b3a-b86d72811a95","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-997cf1d2-221f-4514-bd92-308c3bf4bba9","detail":{"providerEventId":"f05-997cf1d2-221f-4514-bd92-308c3bf4bba9","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-8dff7588-c4b4-4171-8f27-a8707892fb6e","detail":{"providerEventId":"f05-8dff7588-c4b4-4171-8f27-a8707892fb6e","code":"event_conflict"}}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-582f4105-77e3-4fd6-827b-6ed067c83779","orderNo":"bg20261030033518CxJtWP","reason":"wallet_limit"}
 ✓ tests/billing/wechat-notify-crediting.test.ts (11 tests) 14422ms
   ✓ F05 durable idempotent PostgreSQL crediting > credits base and bonus separately using total price rather than coupon-discounted payer_total 301ms
   ✓ F05 durable idempotent PostgreSQL crediting > credits once under duplicate and distinct concurrent provider events for one order 578ms
   ✓ F05 durable idempotent PostgreSQL crediting > does not reuse an event id for a different receipt or order 399ms
   ✓ F05 durable idempotent PostgreSQL crediting > rejects a merchant transaction reused on a different order 344ms
   ✓ F05 durable idempotent PostgreSQL crediting > credits at most one order when one merchant transaction races across orders 310ms
   ✓ F05 durable idempotent PostgreSQL crediting > honors genuine paid funds after local closure and retains the previous close audit 356ms
   ✓ F05 durable idempotent PostgreSQL crediting > recovers a connection crash before commit from a durable receipt after a new app/pool starts 6659ms
   ✓ F05 durable idempotent PostgreSQL crediting > does not double credit when the committed success ACK is lost on the network 329ms
   ✓ F05 durable idempotent PostgreSQL crediting > does not let ten conflicting receipts starve a later valid crash-recovery receipt 1611ms
   ✓ F05 durable idempotent PostgreSQL crediting > records an explicit permanent wallet limit for manual recovery without partial credit 401ms
 ✓ tests/chat/realtime-voice-session.test.ts (14 tests) 21ms
stdout | tests/billing/wallet-ledger-query.test.ts
[F03 HTTP fixture] starting database readiness

stdout | tests/billing/wallet-ledger-query.test.ts
[F03 HTTP fixture] database ready; creating Nest fixture
[F03 HTTP fixture] Nest created; binding loopback listener
[F03 HTTP fixture] listener ready

 ✓ tests/billing/wallet-ledger-query.test.ts (9 tests) 1346ms
{"level":"info","msg":"billing_orders_expired","traceId":"billing-order-expiry:bf1bfbf7-9352-4ff5-bcc2-a79a645b54de","closedCount":1}
{"level":"error","msg":"billing_order_expiry_failed","traceId":"billing-order-expiry:4735773a-3c32-4224-a309-03f20954c724","detail":{"stage":"expiry_sweep","code":"other"}}
{"level":"info","msg":"billing_orders_expired","traceId":"billing-order-expiry:b46412c0-4160-4299-820a-0f223fddca09","closedCount":2}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"billing_late_paid_order","traceId":"f05-4b68426a-8f3e-491a-9c8f-d8540c955c75","orderNo":"bg20261016000000379174"}
{"level":"info","msg":"billing_late_paid_order","traceId":"f05-f76eccf4-c9ff-4b54-973f-79b8b5ce7ff0","orderNo":"bg20261016000000a77024"}
 ✓ tests/billing/order-close-task.test.ts (10 tests) 3015ms
   ✓ F07 actual PostgreSQL expiry and payment races > closes only expired PENDING snapshots, stamps closure once and exposes CLOSED through the real API 484ms
 ✓ tests/billing/realtime-voice-credit-pg.test.ts (6 tests) 2187ms
   ✓ bills cumulative provider response usage once, completes into debt and blocks a new connection 403ms
 ✓ tests/billing/subscription-credit-backfill.test.ts (7 tests) 901ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"instance telemetry disabled (endpoint_unset)","traceId":"instance-telemetry"}
{"level":"info","msg":"dev-process projection sync disabled (WSX_DEV_PROJECTION_SYNC_ORG unset)","traceId":"dev-process-projection-sync"}
{"level":"info","msg":"kg embedding worker not started: no embedding model configured; memory recall uses text + graph only","traceId":"kg-embedding","code":"embedding_not_configured"}
{"level":"error","msg":"http exception","traceId":"e8976708-fc58-49c8-9a07-6180b0c6eaac","detail":{"name":"UnauthorizedException","message":"unauthenticated","stack":"UnauthorizedException: unauthenticated\n    at PrincipalGuard.canActivate (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/guards/principal.guard.ts:54:27)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
 ✓ tests/billing/billing-config.test.ts (21 tests) 26414ms
 ✓ tests/billing/credit-model-pg.integration.test.ts (4 tests) 1603ms
 ✓ tests/billing/credit-stream-settlement.test.ts (5 tests) 851ms
 ✓ tests/chat/realtime-voice-transcript-real-db.test.ts (4 tests) 742ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"http exception","traceId":"70c07852-50df-47fd-a98d-3cf5553107a7","detail":{"name":"UnauthorizedException","message":"unauthenticated","stack":"UnauthorizedException: unauthenticated\n    at PrincipalGuard.canActivate (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/guards/principal.guard.ts:54:27)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"contract validation failed","traceId":"35605e4e-42dc-4488-bba3-09e86efa897e","detail":{"name":"ContractValidationError","message":"validation_failed","stack":"ContractValidationError: validation_failed\n    at ZodBodyPipe.transform (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/pipes/zod-body.pipe.ts:41:11)\n    at /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/node_modules/.pnpm/@nestjs+core@10.4.22_@nestjs+common@10.4.22_class-transformer@0.5.1_class-validator@0.14.4_re_sgffei4zmw63aa4v2dkhbu25m4/node_modules/@nestjs/core/pipes/pipes-consumer.js:16:33\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"27aadd40-3642-4f72-8ba3-2851db82d170","detail":{"stage":"http","reason":"upstream_http_error","status":500,"orderNo":"bg20261030033606iC7EfB"}}
{"level":"error","msg":"http exception","traceId":"27aadd40-3642-4f72-8ba3-2851db82d170","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"b0105064-9dba-44dc-a41c-1f811081cf95","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg202610300336060IdEwW"}}
{"level":"error","msg":"http exception","traceId":"b0105064-9dba-44dc-a41c-1f811081cf95","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"b90e9419-616d-4b78-a6fe-9a00cbc60fce","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030033606FiZfsJ"}}
{"level":"error","msg":"http exception","traceId":"b90e9419-616d-4b78-a6fe-9a00cbc60fce","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"da64da08-b535-4d51-b1b0-9e7c07239b03","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg2026103003360686wNdJ"}}
{"level":"error","msg":"http exception","traceId":"da64da08-b535-4d51-b1b0-9e7c07239b03","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"347ba410-154d-4abe-9a8d-d8a15b10a6d4","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030033606ySmiXi"}}
{"level":"error","msg":"http exception","traceId":"347ba410-154d-4abe-9a8d-d8a15b10a6d4","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"05a6551b-e955-41fe-8baa-315a669426ec","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030033606qCFZxo"}}
{"level":"error","msg":"http exception","traceId":"05a6551b-e955-41fe-8baa-315a669426ec","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"c0edd128-5287-467f-8077-3be0a6051040","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030033607Qfkzg1"}}
{"level":"error","msg":"http exception","traceId":"c0edd128-5287-467f-8077-3be0a6051040","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"e6c156b5-75ff-4f7a-a326-4444c8c44dce","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030033607eizFSv"}}
{"level":"error","msg":"http exception","traceId":"e6c156b5-75ff-4f7a-a326-4444c8c44dce","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"3b828ce8-de08-463a-b0d8-ae4ec9d9e76a","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg202610300336071DDY0V"}}
{"level":"error","msg":"http exception","traceId":"3b828ce8-de08-463a-b0d8-ae4ec9d9e76a","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"987dd13b-4d85-4251-872b-fa32a09d4e72","detail":{"stage":"qr","reason":"response_qr_invalid","status":200,"orderNo":"bg20261030033607TsKV7l"}}
{"level":"error","msg":"http exception","traceId":"987dd13b-4d85-4251-872b-fa32a09d4e72","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"6afe9010-ff88-4a06-b559-7b27aec08dc8","detail":{"stage":"qr","reason":"response_qr_invalid","status":200,"orderNo":"bg20261030033607ek1Wxa"}}
{"level":"error","msg":"http exception","traceId":"6afe9010-ff88-4a06-b559-7b27aec08dc8","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"996a720e-5461-4acd-a1f0-d171d529bd54","detail":{"stage":"json","reason":"response_json_invalid","status":200,"orderNo":"bg20261030033607E4NJNq"}}
{"level":"error","msg":"http exception","traceId":"996a720e-5461-4acd-a1f0-d171d529bd54","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"61734c59-0376-4394-81bf-c688faffce81","detail":{"stage":"request","reason":"request_failed","orderNo":"bg20261030033607YHrxo1"}}
{"level":"error","msg":"http exception","traceId":"61734c59-0376-4394-81bf-c688faffce81","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"5faa1ea4-3443-4d35-891d-319421ead4a4","detail":{"stage":"body","reason":"response_body_invalid","status":200,"orderNo":"bg202610300336075FT8gY"}}
{"level":"error","msg":"http exception","traceId":"5faa1ea4-3443-4d35-891d-319421ead4a4","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_native_failed","traceId":"995211a7-c9fc-4cac-8710-1d4199539d8f","detail":{"stage":"request","reason":"request_timeout","orderNo":"bg202610300336075Z1uyy"}}
{"level":"error","msg":"http exception","traceId":"995211a7-c9fc-4cac-8710-1d4199539d8f","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_native_failed","traceId":"9a49b2d6-366a-40e8-83cd-36b60f27af73","detail":{"stage":"body","reason":"request_timeout","status":200,"orderNo":"bg20261030033615ffmj5Z"}}
{"level":"error","msg":"http exception","traceId":"9a49b2d6-366a-40e8-83cd-36b60f27af73","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"3a2c5728-ccf5-4410-a402-b9c03e93d6ad","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"unhandled exception","traceId":"fb07379a-c763-46c6-a886-f0d886e667b5","detail":{"name":"error","message":"insert or update on table \"billing_orders\" violates foreign key constraint \"billing_orders_package_id_fkey\"","stack":"error: insert or update on table \"billing_orders\" violates foreign key constraint \"billing_orders_package_id_fkey\"\n    at /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/client.js:652:17\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)\n    at Object.query (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/infrastructure/db/pg-database.ts:62:21)\n    at /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/infrastructure/billing/pg-billing-order-repository.ts:37:22\n    at PgDatabase.inTx (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/infrastructure/db/pg-database.ts:74:19)\n    at BillingOrderService.create (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/application/billing/billing-order-service.ts:80:61)\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:14:18)"}}
{"level":"error","msg":"http exception","traceId":"bb23b4f1-c3fe-4811-8c17-b5ec3bbbc6d4","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"63faea23-2aa6-4bce-a4ad-9250312f80dc","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"0db971b8-c482-4686-9482-79db25c6d9e8","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
 ✓ tests/billing/order-core.test.ts (26 tests) 19396ms
   ✓ F04 real Native order HTTP and PostgreSQL > does not persist a fake order on timeout-headers 8069ms
   ✓ F04 real Native order HTTP and PostgreSQL > does not persist a fake order on timeout-body 8129ms
 ✓ tests/billing/credit-period-lifecycle-pg.test.ts (6 tests) 1995ms
 ✓ tests/billing/private-auxiliary-credit-pg.test.ts (5 tests) 910ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"billing_late_paid_order","traceId":"f05-ec05a2e2-f27b-43fa-8e9f-55f17bc79496","orderNo":"bg20261030033631cEDxmp"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-c935b250-2f94-42a8-bd55-1899418bafe8","orderNo":"bg20261030033631WROhoU","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-79281a42-5c5f-44fe-ab73-c321435fcee9","orderNo":"bg20261030033631ZeGayP","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-2e41cdbe-9c4f-41c1-8057-27d81c2a5f71","orderNo":"bg20261030033632V1mCbn","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-68eee174-4101-4e97-8f09-4a823aef3bab","orderNo":"bg20261030033632TiJQN4","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-d6784762-f6fd-459e-a31c-3e2fa7884a30","orderNo":"bg20261030033632D5FOOx","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-bf2aceb6-78dc-4535-8d27-e035e0e3866a","orderNo":"bg20261030033632Xc01PR","reason":"wallet_limit"}
 ✓ tests/billing/wechat-notify-outcomes.test.ts (8 tests) 3049ms
 ✓ tests/billing/credit-model-gateway.test.ts (10 tests) 18ms
 ✓ tests/billing/credit-admission-policy-pg.test.ts (6 tests) 1975ms
 ✓ tests/billing/personal-credit-usage.test.ts (3 tests) 2242ms
 ✓ tests/billing/consumption-settings.test.ts (4 tests) 314ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
 ✓ tests/billing/wechat-notify-verify.test.ts (13 tests) 5966ms
   ✓ F05 raw WeChat callback cryptographic boundary > rejects stale before crediting, without poisoning the real event id 344ms
   ✓ F05 raw WeChat callback cryptographic boundary > rejects unknown-key before crediting, without poisoning the real event id 471ms
   ✓ F05 raw WeChat callback cryptographic boundary > rejects wrong-rsa before crediting, without poisoning the real event id 949ms
   ✓ F05 raw WeChat callback cryptographic boundary > rejects a signed receipt inconsistent with merchant or order: {"appid":"other-app"} 393ms
   ✓ F05 raw WeChat callback cryptographic boundary > rejects a signed receipt inconsistent with merchant or order: {"amount":{"total":9901,"currency":"CNY"}} 359ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"http exception","traceId":"dc00d230-4f4c-4283-af1f-d9bfb7bfeb84","detail":{"name":"UnauthorizedException","message":"unauthenticated","stack":"UnauthorizedException: unauthenticated\n    at PrincipalGuard.canActivate (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/guards/principal.guard.ts:54:27)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"38d78f79-44c4-4087-837a-86e4ad79dbc7","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"8b2d23fd-8d4b-4195-a7f0-f457a1c8e7e9","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_close_failed","traceId":"afe6c848-e499-4a24-9b75-a469bff5265c","detail":{"orderNo":"bg20261030033652nRGpkQ","reason":"merchant_closure_unconfirmed"}}
{"level":"error","msg":"http exception","traceId":"afe6c848-e499-4a24-9b75-a469bff5265c","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_close_failed","traceId":"3dc40ec9-befc-4447-8bfa-1500d566c08b","detail":{"orderNo":"bg202610300336542z0m8w","reason":"merchant_closure_unconfirmed"}}
{"level":"error","msg":"http exception","traceId":"3dc40ec9-befc-4447-8bfa-1500d566c08b","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"23bb44ee-4fbe-4e4a-a4a4-e776be170ca9","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"http exception","traceId":"cee3a3df-8def-4908-9e35-ea239bdc0291","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
 ✓ tests/billing/order-cancel.test.ts (8 tests) 6564ms
   ✓ authenticated unpaid order cancellation > accepts an already-closed merchant response after an interrupted cancellation 306ms
   ✓ authenticated unpaid order cancellation > does not close locally on an untrusted merchant response 2371ms
   ✓ authenticated unpaid order cancellation > does not treat a manual paid recovery closure as a customer cancellation 1334ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"http exception","traceId":"3394d97a-18c1-4d83-a316-d1ec7b65ce79","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"contract validation failed","traceId":"fa32e187-d1ea-40d5-955d-cc3699776a77","detail":{"name":"ContractValidationError","message":"validation_failed","stack":"ContractValidationError: validation_failed\n    at ZodBodyPipe.transform (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/pipes/zod-body.pipe.ts:41:11)\n    at /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/node_modules/.pnpm/@nestjs+core@10.4.22_@nestjs+common@10.4.22_class-transformer@0.5.1_class-validator@0.14.4_re_sgffei4zmw63aa4v2dkhbu25m4/node_modules/@nestjs/core/pipes/pipes-consumer.js:16:33\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"6e22047f-d914-4667-b625-c76adb2c723b","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"86b65357-c45b-445a-b2fc-5ff219d5d64c","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"84c9500f-88fd-4ed8-9b24-51a1ffbfa470","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"180e0a55-4fbb-476f-8e46-318049b84af2","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"9ba8ffbf-bf0b-4ad6-92f1-338f6825d4cc","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"39f7f2e3-21f1-4ddc-b3b2-aaba8fe10240","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
 ✓ tests/billing/order-ownership.test.ts (6 tests) 4967ms
   ✓ F04 HTTP order ownership with persisted memberships > requires explicit organization and the actual target administrator 563ms
   ✓ F04 HTTP order ownership with persisted memberships > does not let an ordinary member inspect team order QR or amount 395ms
 ✓ tests/billing/wechat-notify-observability.test.ts (4 tests) 9ms
 ✓ tests/billing/native-credit-tariff-pg.test.ts (3 tests) 1580ms
 ✓ tests/billing/chat-read-asr-credit-fixture.test.ts (2 tests) 1102ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
 ✓ tests/billing/wechat-reference-compatibility.test.ts (5 tests) 2534ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_native_failed","traceId":"a5c7239e-d53f-404e-baff-c189d642c0f0","detail":{"stage":"json","reason":"response_json_invalid","status":200,"orderNo":"bg20261030033716uzA3E3"}}
{"level":"error","msg":"http exception","traceId":"a5c7239e-d53f-404e-baff-c189d642c0f0","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"native-safe-trace","detail":{"stage":"http","reason":"upstream_http_error","status":500,"orderNo":"bg20261030033716o7kXvx"}}
{"level":"error","msg":"billing_native_failed","traceId":"native-safe-trace","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030033716kySvyQ"}}
{"level":"error","msg":"billing_native_failed","traceId":"native-safe-trace","detail":{"stage":"json","reason":"response_json_invalid","status":200,"orderNo":"bg20261030033716SYg9lE"}}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_native_failed","traceId":"native-safe-trace","detail":{"stage":"request","reason":"request_timeout","orderNo":"bg20261030033717IZZr7A"}}
 ✓ tests/billing/native-failure-diagnostics.test.ts (5 tests) 10232ms
   ✓ Native merchant failure diagnostics > retains safe timeout-headers cause and trace without signed bodies or credentials 8162ms
 ✓ tests/billing/native-read-deadline.test.ts (2 tests) 59ms
 ✓ tests/billing/consumption-settings-pg.test.ts (2 tests) 1457ms
 ✓ tests/auth/ai-usage-scope.test.ts (4 tests) 49ms
 ✓ tests/billing/credit-error-boundary.test.ts (3 tests) 11ms
 ✓ tests/billing/reference-package-catalog.test.ts (2 tests) 820ms
 ✓ tests/billing/credit-periods-pg.test.ts (1 test) 796ms
 ✓ tests/billing/subscription-credit-checkpoint.test.ts (6 tests) 4ms
 ✓ tests/billing/global-error-boundary.test.ts (4 tests) 11ms
 ✓ tests/billing/credit-execution-context.test.ts (2 tests) 14ms
 ✓ tests/billing/private-credit-failure.test.ts (3 tests) 25ms
 ✓ tests/billing/credit-auxiliary-errors.test.ts (3 tests) 5ms
 ✓ tests/billing/billing-global-boundary.test.ts (9 tests) 8ms
 ✓ tests/billing/credit-run-error-contract.test.ts (1 test) 479ms

 Test Files  46 passed (46)
      Tests  406 passed (406)
   Start at  11:32:31
   Duration  307.01s (transform 20.37s, setup 503ms, collect 47.85s, tests 231.09s, environment 10ms, prepare 4.91s)

[db-isolation] db=wsx_866dc020a6fad1513850 peak_connections=9
[timing] pnpm --filter @repo/api exec vitest run tests/billing tests/auth/ai-usage-repository.test.ts tests/auth/ai-usage-scope.test.ts tests/chat/realtime-digital-human-gateway.test.ts tests/chat/realtime-voice-session.test.ts tests/chat/realtime-voice-transcript-real-db.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：5m9s
  清理：1s
  总计：5m10s
