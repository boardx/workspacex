[stack-admission] load1=6.28 cores=10 perCore=0.63 running=0/2
[test-isolation] id=run-mvucl7uo-0d7849e3-5581c93d7c61 db=wsx_5581c93d7c6196104463 compose=wsx-5581c93d7c6196104463 pg=20021 redis=21021 api=24021 web=25021 sandbox=26021 model=27021 deep-agent=28021 asr=29021 vision=30021 loopback-sandbox=31021 mail=19021

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_5581c93d7c6196104463 capacity=100 current=6 required=32
[realtime-digital-human] upstream error: {"code":"InvalidApiKey","message":"secret detail"}
 ✓ tests/chat/realtime-digital-human-gateway.test.ts (33 tests) 3471ms
   ✓ WS /chat/realtime-digital-human — Chat 语音模式 > upstream close remains bounded when append never resolves, without a false persisted acknowledgement 2013ms
   ✓ WS /chat/realtime-digital-human — Chat 语音模式 > explicit browser loopback keeps a finite PCM stream actionable and cancels its next chunk 523ms
   ✓ WS /chat/realtime-digital-human — Chat 语音模式 > loopback omni upstream: readable Chinese user + role-aware assistant turn is relayed as live captions, audio and persisted 626ms
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
 ✓ tests/billing/stripe-webhook.test.ts (27 tests) 12014ms
 ✓ tests/billing/subscription-links.test.ts (33 tests) 18036ms
   ✓ F08 real subscription HTTP/PG > rejects unsafe provider response timeout without mutating subscription 8068ms
   ✓ F08 real subscription HTTP/PG > rejects unsafe provider response headers-timeout without mutating subscription 8048ms
 ✓ tests/auth/ai-usage-repository.test.ts (15 tests) 3319ms
   ✓ late original usage enriches one physical call, preserves raw base and historical asOf 320ms
 ✓ tests/billing/schema-migration.test.ts (16 tests) 767ms
 ✓ tests/billing/credit-consumption-pg.test.ts (16 tests) 882ms
 ✓ tests/billing/durable-credit-usage.test.ts (16 tests) 2264ms
   ✓ admits twenty normal concurrent starts without spurious accounting failures 427ms
   ✓ repeated confirmed predispatch credit rejection never consumes spool capacity 1522ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"billing_callback_pending","traceId":"78087913-057d-42db-89ba-e42b47c45c4a","stage":"credit","providerEventId":"f05-4a5ee933-c656-400f-9997-8f66607f6bcb","orderNo":"bg20261030022405eYYuCb"}
{"level":"info","msg":"billing_callback_pending","traceId":"aab89467-9a39-4b69-b50f-d2507c8fdaf5","stage":"credit","providerEventId":"f05-4a5ee933-c656-400f-9997-8f66607f6bcb","orderNo":"bg20261030022405eYYuCb"}
{"level":"info","msg":"billing_callback_pending","traceId":"1517ad5c-593a-4954-9aab-8045faf137ae","stage":"credit","providerEventId":"f05-4a5ee933-c656-400f-9997-8f66607f6bcb","orderNo":"bg20261030022405eYYuCb"}
{"level":"info","msg":"billing_callback_pending","traceId":"dae51bb1-1c05-4dc3-aa64-e4861d77bc51","stage":"credit","providerEventId":"f05-4a5ee933-c656-400f-9997-8f66607f6bcb","orderNo":"bg20261030022405eYYuCb"}
{"level":"info","msg":"billing_callback_pending","traceId":"7d577e0b-8aea-47c8-8a18-c001d3b1a6db","stage":"credit","providerEventId":"f05-4a5ee933-c656-400f-9997-8f66607f6bcb","orderNo":"bg20261030022405eYYuCb"}
{"level":"error","msg":"billing_callback_failed","traceId":"cf70d8ca-9a36-4a86-b136-0ec6a002de58","detail":{"stage":"accept","code":"23505","providerEventId":"f05-de91b41b-fccd-41dc-ac81-181232a27875","orderNo":"bg20261030022405MrJ81E"}}
{"level":"info","msg":"billing_late_paid_order","traceId":"f05-9b552652-090a-43b3-9750-8f5f90551a93","orderNo":"bg20261030022405kLUQjn"}
{"level":"info","msg":"database_connection_error","traceId":"database","code":"unknown"}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-9270e1b7-8323-43fe-8622-ab4fbdc25415","detail":{"providerEventId":"f05-9270e1b7-8323-43fe-8622-ab4fbdc25415","code":"57P01"}}
{"level":"info","msg":"billing_callback_pending","traceId":"57ff6279-17db-43a4-9e5e-bab59a8a0e9f","stage":"credit","providerEventId":"f05-9270e1b7-8323-43fe-8622-ab4fbdc25415","orderNo":"bg20261030022405LzfkSN"}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-e9ad2e94-84b3-4e59-bdcf-c4abe54401c3","detail":{"providerEventId":"f05-e9ad2e94-84b3-4e59-bdcf-c4abe54401c3","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-d2c868a5-1710-44bf-ac8b-5938ca68a1f6","detail":{"providerEventId":"f05-d2c868a5-1710-44bf-ac8b-5938ca68a1f6","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-4f545ceb-e160-4061-8d37-c9ee1ad0a483","detail":{"providerEventId":"f05-4f545ceb-e160-4061-8d37-c9ee1ad0a483","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-65a9eda8-8fa2-47e4-9ed4-cb41c6290f1a","detail":{"providerEventId":"f05-65a9eda8-8fa2-47e4-9ed4-cb41c6290f1a","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-6509c7f6-a736-4618-bbd1-656dcfd1a98e","detail":{"providerEventId":"f05-6509c7f6-a736-4618-bbd1-656dcfd1a98e","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-d6b2b66c-4271-4d6e-b0ac-ec2b3690492d","detail":{"providerEventId":"f05-d6b2b66c-4271-4d6e-b0ac-ec2b3690492d","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-4595ac95-fa02-4928-b364-4b9524351fdf","detail":{"providerEventId":"f05-4595ac95-fa02-4928-b364-4b9524351fdf","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-3524bdac-6a4c-4b6c-8c20-aa09df5b1395","detail":{"providerEventId":"f05-3524bdac-6a4c-4b6c-8c20-aa09df5b1395","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-732052b0-ccc2-4e4d-96a7-79b18ded6c5c","detail":{"providerEventId":"f05-732052b0-ccc2-4e4d-96a7-79b18ded6c5c","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-8d14f3cd-19cb-460e-9101-450742adeb6a","detail":{"providerEventId":"f05-8d14f3cd-19cb-460e-9101-450742adeb6a","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-e9ad2e94-84b3-4e59-bdcf-c4abe54401c3","detail":{"providerEventId":"f05-e9ad2e94-84b3-4e59-bdcf-c4abe54401c3","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-d2c868a5-1710-44bf-ac8b-5938ca68a1f6","detail":{"providerEventId":"f05-d2c868a5-1710-44bf-ac8b-5938ca68a1f6","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-4f545ceb-e160-4061-8d37-c9ee1ad0a483","detail":{"providerEventId":"f05-4f545ceb-e160-4061-8d37-c9ee1ad0a483","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-65a9eda8-8fa2-47e4-9ed4-cb41c6290f1a","detail":{"providerEventId":"f05-65a9eda8-8fa2-47e4-9ed4-cb41c6290f1a","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-6509c7f6-a736-4618-bbd1-656dcfd1a98e","detail":{"providerEventId":"f05-6509c7f6-a736-4618-bbd1-656dcfd1a98e","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-d6b2b66c-4271-4d6e-b0ac-ec2b3690492d","detail":{"providerEventId":"f05-d6b2b66c-4271-4d6e-b0ac-ec2b3690492d","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-4595ac95-fa02-4928-b364-4b9524351fdf","detail":{"providerEventId":"f05-4595ac95-fa02-4928-b364-4b9524351fdf","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-3524bdac-6a4c-4b6c-8c20-aa09df5b1395","detail":{"providerEventId":"f05-3524bdac-6a4c-4b6c-8c20-aa09df5b1395","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-732052b0-ccc2-4e4d-96a7-79b18ded6c5c","detail":{"providerEventId":"f05-732052b0-ccc2-4e4d-96a7-79b18ded6c5c","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-8d14f3cd-19cb-460e-9101-450742adeb6a","detail":{"providerEventId":"f05-8d14f3cd-19cb-460e-9101-450742adeb6a","code":"event_conflict"}}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-93b1ea18-4873-4630-bd7a-ead9106edd13","orderNo":"bg20261030022412hY9CNP","reason":"wallet_limit"}
 ✓ tests/billing/wechat-notify-crediting.test.ts (11 tests) 8210ms
   ✓ F05 durable idempotent PostgreSQL crediting > recovers a connection crash before commit from a durable receipt after a new app/pool starts 5898ms
   ✓ F05 durable idempotent PostgreSQL crediting > does not let ten conflicting receipts starve a later valid crash-recovery receipt 360ms
 ✓ tests/chat/realtime-voice-session.test.ts (14 tests) 5ms
stdout | tests/billing/wallet-ledger-query.test.ts
[F03 HTTP fixture] starting database readiness

stdout | tests/billing/wallet-ledger-query.test.ts
[F03 HTTP fixture] database ready; creating Nest fixture
[F03 HTTP fixture] Nest created; binding loopback listener
[F03 HTTP fixture] listener ready

 ✓ tests/billing/wallet-ledger-query.test.ts (9 tests) 550ms
{"level":"info","msg":"billing_orders_expired","traceId":"billing-order-expiry:454386f8-45d4-46f0-81a5-8949b012da1f","closedCount":1}
{"level":"error","msg":"billing_order_expiry_failed","traceId":"billing-order-expiry:df500700-1d32-458a-9c8b-852f4f1daca4","detail":{"stage":"expiry_sweep","code":"other"}}
{"level":"info","msg":"billing_orders_expired","traceId":"billing-order-expiry:a3287fb2-b0a6-4533-9745-6c4d6ae3929c","closedCount":2}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"billing_late_paid_order","traceId":"f05-fa580a1d-a0f9-4f72-af95-8b19a4873e20","orderNo":"bg20261016000000c642e1"}
{"level":"info","msg":"billing_late_paid_order","traceId":"f05-444e55e6-087e-425f-ae73-0e26727b966b","orderNo":"bg202610160000002a0a31"}
 ✓ tests/billing/order-close-task.test.ts (10 tests) 1383ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"instance telemetry disabled (endpoint_unset)","traceId":"instance-telemetry"}
{"level":"info","msg":"dev-process projection sync disabled (WSX_DEV_PROJECTION_SYNC_ORG unset)","traceId":"dev-process-projection-sync"}
{"level":"info","msg":"kg embedding worker not started: no embedding model configured; memory recall uses text + graph only","traceId":"kg-embedding","code":"embedding_not_configured"}
{"level":"error","msg":"http exception","traceId":"5a3f792c-aa8a-4ad6-b829-6f174aaefdbb","detail":{"name":"UnauthorizedException","message":"unauthenticated","stack":"UnauthorizedException: unauthenticated\n    at PrincipalGuard.canActivate (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/guards/principal.guard.ts:54:27)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
 ✓ tests/billing/billing-config.test.ts (21 tests) 5969ms
 ✓ tests/billing/credit-model-pg.integration.test.ts (4 tests) 566ms
 ✓ tests/chat/realtime-voice-transcript-real-db.test.ts (4 tests) 412ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"http exception","traceId":"3e210a4b-b1e2-4630-81ba-8acd63d5cb71","detail":{"name":"UnauthorizedException","message":"unauthenticated","stack":"UnauthorizedException: unauthenticated\n    at PrincipalGuard.canActivate (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/guards/principal.guard.ts:54:27)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"contract validation failed","traceId":"2aa84ca1-75e3-4a6b-b0cf-c57234045087","detail":{"name":"ContractValidationError","message":"validation_failed","stack":"ContractValidationError: validation_failed\n    at ZodBodyPipe.transform (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/pipes/zod-body.pipe.ts:41:11)\n    at /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/node_modules/.pnpm/@nestjs+core@10.4.22_@nestjs+common@10.4.22_class-transformer@0.5.1_class-validator@0.14.4_re_sgffei4zmw63aa4v2dkhbu25m4/node_modules/@nestjs/core/pipes/pipes-consumer.js:16:33\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"fe2f29fb-db39-4018-9db8-3fe0198974cd","detail":{"stage":"http","reason":"upstream_http_error","status":500,"orderNo":"bg20261030022424hQNjeS"}}
{"level":"error","msg":"http exception","traceId":"fe2f29fb-db39-4018-9db8-3fe0198974cd","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"39d7c066-bd08-4679-b10e-0843b83cecf6","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030022424qfuy6U"}}
{"level":"error","msg":"http exception","traceId":"39d7c066-bd08-4679-b10e-0843b83cecf6","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"663fbf98-b92e-46d1-80d5-e36c3870e5d0","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg202610300224242D148b"}}
{"level":"error","msg":"http exception","traceId":"663fbf98-b92e-46d1-80d5-e36c3870e5d0","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"6ff37742-775c-422f-bb54-efc9d2676eff","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030022425EItj2O"}}
{"level":"error","msg":"http exception","traceId":"6ff37742-775c-422f-bb54-efc9d2676eff","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"42bdcf06-67e5-43cb-ba15-3c9bc99776da","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030022425u1DlvG"}}
{"level":"error","msg":"http exception","traceId":"42bdcf06-67e5-43cb-ba15-3c9bc99776da","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"346226f4-705e-4a21-bd9f-770d680b52fc","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030022425O59XZf"}}
{"level":"error","msg":"http exception","traceId":"346226f4-705e-4a21-bd9f-770d680b52fc","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"cd96a1d1-8784-41f8-8f6e-dd057c9f5365","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg202610300224250XIB3M"}}
{"level":"error","msg":"http exception","traceId":"cd96a1d1-8784-41f8-8f6e-dd057c9f5365","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"7988d6c1-8c01-4150-aa75-8fbf83b11d45","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg2026103002242583iV8H"}}
{"level":"error","msg":"http exception","traceId":"7988d6c1-8c01-4150-aa75-8fbf83b11d45","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"64d798e5-45d4-43c1-8fb8-db511eb7979b","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030022425s47Pl8"}}
{"level":"error","msg":"http exception","traceId":"64d798e5-45d4-43c1-8fb8-db511eb7979b","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"d03191c3-6d2e-4993-ac5d-9fafd075348d","detail":{"stage":"qr","reason":"response_qr_invalid","status":200,"orderNo":"bg20261030022425stvcEc"}}
{"level":"error","msg":"http exception","traceId":"d03191c3-6d2e-4993-ac5d-9fafd075348d","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"af89a578-9d5a-492a-bbaa-41e9d75ad7e8","detail":{"stage":"qr","reason":"response_qr_invalid","status":200,"orderNo":"bg20261030022425Mx86MT"}}
{"level":"error","msg":"http exception","traceId":"af89a578-9d5a-492a-bbaa-41e9d75ad7e8","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"856cf015-e21c-4df4-b112-8c5becb63e46","detail":{"stage":"json","reason":"response_json_invalid","status":200,"orderNo":"bg20261030022425CnUvsb"}}
{"level":"error","msg":"http exception","traceId":"856cf015-e21c-4df4-b112-8c5becb63e46","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"ae00234b-e1cf-4c17-a78c-1bea5bb383ae","detail":{"stage":"request","reason":"request_failed","orderNo":"bg20261030022425EMXgRw"}}
{"level":"error","msg":"http exception","traceId":"ae00234b-e1cf-4c17-a78c-1bea5bb383ae","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"5d6ef4dc-ded7-42db-b786-32b477a33cdc","detail":{"stage":"body","reason":"response_body_invalid","status":200,"orderNo":"bg20261030022425a1xzLO"}}
{"level":"error","msg":"http exception","traceId":"5d6ef4dc-ded7-42db-b786-32b477a33cdc","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_native_failed","traceId":"3787479f-2935-4bd3-97a8-7484d2aa965c","detail":{"stage":"request","reason":"request_timeout","orderNo":"bg202610300224255g9T1d"}}
{"level":"error","msg":"http exception","traceId":"3787479f-2935-4bd3-97a8-7484d2aa965c","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_native_failed","traceId":"f4c7766b-eeee-4a09-8c2b-cce90352c936","detail":{"stage":"body","reason":"request_timeout","status":200,"orderNo":"bg202610300224334r6epI"}}
{"level":"error","msg":"http exception","traceId":"f4c7766b-eeee-4a09-8c2b-cce90352c936","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"b227e7a8-b69e-4373-9088-ee70e95a46ea","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"unhandled exception","traceId":"c688f758-92e3-4fae-a2b7-79152bb13617","detail":{"name":"error","message":"insert or update on table \"billing_orders\" violates foreign key constraint \"billing_orders_package_id_fkey\"","stack":"error: insert or update on table \"billing_orders\" violates foreign key constraint \"billing_orders_package_id_fkey\"\n    at /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/client.js:652:17\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)\n    at Object.query (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/infrastructure/db/pg-database.ts:62:21)\n    at /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/infrastructure/billing/pg-billing-order-repository.ts:37:22\n    at PgDatabase.inTx (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/infrastructure/db/pg-database.ts:74:19)\n    at BillingOrderService.create (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/application/billing/billing-order-service.ts:80:61)\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:14:18)"}}
{"level":"error","msg":"http exception","traceId":"2acd9c48-094a-4b1e-9603-840a4d2229e6","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"e7e6b2ad-e5f3-4e3b-a638-611ed17fc8dc","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"8d268b68-fef6-4c67-b4e6-6294d4b5d72a","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
 ✓ tests/billing/order-core.test.ts (26 tests) 18506ms
   ✓ F04 real Native order HTTP and PostgreSQL > does not persist a fake order on timeout-headers 8086ms
   ✓ F04 real Native order HTTP and PostgreSQL > does not persist a fake order on timeout-body 8104ms
 ✓ tests/billing/realtime-voice-credit-pg.test.ts (5 tests) 1688ms
   ✓ bills cumulative provider response usage once, completes into debt and blocks a new connection 375ms
 ✓ tests/billing/credit-period-lifecycle-pg.test.ts (6 tests) 761ms
 ✓ tests/billing/credit-stream-settlement.test.ts (4 tests) 532ms
 ✓ tests/billing/private-auxiliary-credit-pg.test.ts (5 tests) 585ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"billing_late_paid_order","traceId":"f05-47d96b25-0dd8-45d9-b874-8227eaf4aa4b","orderNo":"bg202610300224489Lb9we"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-a7462d38-0791-4c92-843f-63db9b381fc5","orderNo":"bg202610300224496Uv7gh","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-be24ced0-c117-4a7a-9e29-0ec4b373ab64","orderNo":"bg20261030022449lSRas0","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-8774d80b-7f31-439c-9a08-4a1067a381ce","orderNo":"bg20261030022449gGk2bz","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-1e6cb5b6-b19a-4515-92f6-717c9f7be408","orderNo":"bg20261030022449pBl4pB","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-d3e65be9-c259-43d0-a09e-8d64c9dac770","orderNo":"bg20261030022449BGMFPf","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-387fa6b7-50d8-4f76-8f35-0debf07e8f1d","orderNo":"bg20261030022449NwhBVn","reason":"wallet_limit"}
 ✓ tests/billing/wechat-notify-outcomes.test.ts (8 tests) 1780ms
 ✓ tests/billing/subscription-credit-backfill.test.ts (6 tests) 360ms
 ✓ tests/billing/credit-model-gateway.test.ts (10 tests) 6ms
 ✓ tests/billing/credit-admission-policy-pg.test.ts (6 tests) 603ms
 ✓ tests/billing/personal-credit-usage.test.ts (3 tests) 618ms
 ✓ tests/billing/consumption-settings.test.ts (4 tests) 126ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
 ✓ tests/billing/wechat-notify-verify.test.ts (13 tests) 2271ms
   ✓ F05 raw WeChat callback cryptographic boundary > rejects wrong-rsa before crediting, without poisoning the real event id 385ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"http exception","traceId":"36859d72-6b16-40c2-b244-d67053d1262b","detail":{"name":"UnauthorizedException","message":"unauthenticated","stack":"UnauthorizedException: unauthenticated\n    at PrincipalGuard.canActivate (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/guards/principal.guard.ts:54:27)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"fe8bd7b9-42c1-4b7a-8b4f-97d548be7385","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"ec3ea239-3017-4eb1-b1a9-8e9949898984","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_close_failed","traceId":"fff5d694-41bf-4992-bec4-daba99a28f6b","detail":{"orderNo":"bg20261030022457YGjymn","reason":"merchant_closure_unconfirmed"}}
{"level":"error","msg":"http exception","traceId":"fff5d694-41bf-4992-bec4-daba99a28f6b","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_close_failed","traceId":"706bf433-9e72-4a83-bb56-c1a2e814acb7","detail":{"orderNo":"bg20261030022457USgUUQ","reason":"merchant_closure_unconfirmed"}}
{"level":"error","msg":"http exception","traceId":"706bf433-9e72-4a83-bb56-c1a2e814acb7","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"9729fa6a-9df5-4fac-aa3a-3cbdf5601942","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"751127cb-c495-4dab-9ce0-14ab5c8cf024","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
 ✓ tests/billing/order-cancel.test.ts (8 tests) 1173ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"http exception","traceId":"58c656d6-1efe-44c2-8ad7-d5a8ff1499ae","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"contract validation failed","traceId":"ff4501e3-b93e-4125-a216-7f8a8c339e6f","detail":{"name":"ContractValidationError","message":"validation_failed","stack":"ContractValidationError: validation_failed\n    at ZodBodyPipe.transform (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/pipes/zod-body.pipe.ts:41:11)\n    at /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/node_modules/.pnpm/@nestjs+core@10.4.22_@nestjs+common@10.4.22_class-transformer@0.5.1_class-validator@0.14.4_re_sgffei4zmw63aa4v2dkhbu25m4/node_modules/@nestjs/core/pipes/pipes-consumer.js:16:33\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"e9b45827-72a3-453a-929a-e9b5e6509cee","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"9a10b09e-a9ce-4b4e-b5e9-d158510cff2b","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"03732412-451b-41c1-962c-03a8894dfbca","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"c042a43a-90ef-4b3e-a31b-b73f3376f13b","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"dffdb002-e82d-4202-a9a1-39806fd972fd","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"2298d080-4bf9-41fa-a033-a0231513ae0f","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
 ✓ tests/billing/order-ownership.test.ts (6 tests) 1235ms
 ✓ tests/billing/wechat-notify-observability.test.ts (4 tests) 3ms
 ✓ tests/billing/native-credit-tariff-pg.test.ts (3 tests) 373ms
 ✓ tests/billing/chat-read-asr-credit-fixture.test.ts (2 tests) 353ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
 ✓ tests/billing/wechat-reference-compatibility.test.ts (5 tests) 947ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_native_failed","traceId":"ded03da7-f219-4d1e-9d3d-d2ac4e501fe2","detail":{"stage":"json","reason":"response_json_invalid","status":200,"orderNo":"bg20261030022503tJXWFs"}}
{"level":"error","msg":"http exception","traceId":"ded03da7-f219-4d1e-9d3d-d2ac4e501fe2","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"native-safe-trace","detail":{"stage":"http","reason":"upstream_http_error","status":500,"orderNo":"bg20261030022503BOhele"}}
{"level":"error","msg":"billing_native_failed","traceId":"native-safe-trace","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030022503j5JLWU"}}
{"level":"error","msg":"billing_native_failed","traceId":"native-safe-trace","detail":{"stage":"json","reason":"response_json_invalid","status":200,"orderNo":"bg20261030022503d3UKte"}}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_native_failed","traceId":"native-safe-trace","detail":{"stage":"request","reason":"request_timeout","orderNo":"bg20261030022503yTo7f4"}}
 ✓ tests/billing/native-failure-diagnostics.test.ts (5 tests) 8809ms
   ✓ Native merchant failure diagnostics > retains safe timeout-headers cause and trace without signed bodies or credentials 8055ms
 ✓ tests/billing/native-read-deadline.test.ts (2 tests) 14ms
 ✓ tests/billing/consumption-settings-pg.test.ts (2 tests) 240ms
 ✓ tests/auth/ai-usage-scope.test.ts (4 tests) 4ms
 ✓ tests/billing/credit-error-boundary.test.ts (3 tests) 4ms
 ✓ tests/billing/reference-package-catalog.test.ts (2 tests) 288ms
 ✓ tests/billing/credit-periods-pg.test.ts (1 test) 251ms
 ✓ tests/billing/global-error-boundary.test.ts (4 tests) 5ms
 ✓ tests/billing/credit-execution-context.test.ts (2 tests) 12ms
 ✓ tests/billing/private-credit-failure.test.ts (3 tests) 9ms
 ✓ tests/billing/credit-auxiliary-errors.test.ts (3 tests) 2ms
 ✓ tests/billing/billing-global-boundary.test.ts (9 tests) 3ms
 ✓ tests/billing/credit-run-error-contract.test.ts (1 test) 206ms

 Test Files  45 passed (45)
      Tests  394 passed (394)
   Start at  10:23:13
   Duration  122.11s (transform 4.23s, setup 161ms, collect 13.30s, tests 99.62s, environment 4ms, prepare 1.31s)

[db-isolation] db=wsx_5581c93d7c6196104463 peak_connections=12
[timing] pnpm --filter @repo/api exec vitest run tests/billing tests/auth/ai-usage-repository.test.ts tests/auth/ai-usage-scope.test.ts tests/chat/realtime-digital-human-gateway.test.ts tests/chat/realtime-voice-session.test.ts tests/chat/realtime-voice-transcript-real-db.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：2m3s
  清理：0s
  总计：2m3s
