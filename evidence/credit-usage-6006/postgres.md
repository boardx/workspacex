[stack-admission] load1=5.61 cores=10 perCore=0.56 running=0/2
[stack-admission] 排到了，等了 0s
[test-isolation] id=run-mvuc64w8-0e75bf37-cf9023fcb7cb db=wsx_cf9023fcb7cb0fdcafdb compose=wsx-cf9023fcb7cb0fdcafdb pg=20108 redis=21108 api=24108 web=25108 sandbox=26108 model=27108 deep-agent=28108 asr=29108 vision=30108 loopback-sandbox=31108 mail=19108

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_cf9023fcb7cb0fdcafdb capacity=100 current=6 required=32
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
 ✓ tests/billing/stripe-webhook.test.ts (27 tests) 15914ms
 ✓ tests/billing/subscription-links.test.ts (33 tests) 18561ms
   ✓ F08 real subscription HTTP/PG > rejects unsafe provider response timeout without mutating subscription 8093ms
   ✓ F08 real subscription HTTP/PG > rejects unsafe provider response headers-timeout without mutating subscription 8060ms
   ✓ F08 real subscription HTTP/PG > bounds concurrent abandoned purchases to twenty without invalidating existing links 339ms
 ✓ tests/auth/ai-usage-repository.test.ts (15 tests) 7879ms
   ✓ same ledger reports — isolated PostgreSQL > preserves the microsecond snapshot boundary across summary and call pagination 460ms
   ✓ same ledger reports — isolated PostgreSQL > uses a database-precision default cutoff and clamps a future cutoff to database now 409ms
   ✓ same ledger reports — isolated PostgreSQL > summary, member/model/project and details have matching totals and explicit unknown coverage 325ms
   ✓ same ledger reports — isolated PostgreSQL > filters member×provider/model intersections and explicit unassigned projects 389ms
   ✓ same ledger reports — isolated PostgreSQL > keyset preserves sub-millisecond timestamp precision and asOf excludes new receipts 422ms
   ✓ same ledger reports — isolated PostgreSQL > preserves microsecond snapshot bounds across report projections 540ms
   ✓ same ledger reports — isolated PostgreSQL > native dimensions keep original units, unknown provenance, and one receipt across report projections 930ms
   ✓ same ledger reports — isolated PostgreSQL > database constraints independently reject fabricated Token/native provenance and ledger mutation 535ms
   ✓ same ledger reports — isolated PostgreSQL > ASR personal receipt retains exact active capture owner, null run, tenant fence and terminal idempotence 313ms
 ✓ tests/billing/schema-migration.test.ts (16 tests) 1038ms
 ✓ tests/billing/credit-consumption-pg.test.ts (16 tests) 772ms
 ✓ tests/billing/durable-credit-usage.test.ts (16 tests) 2454ms
   ✓ admits twenty normal concurrent starts without spurious accounting failures 420ms
   ✓ repeated confirmed predispatch credit rejection never consumes spool capacity 1738ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"billing_callback_pending","traceId":"034d46eb-35ce-4c2e-9f5c-374dd0ef9b40","stage":"credit","providerEventId":"f05-72fd9e72-00e4-4e8f-b460-9aab790b8aae","orderNo":"bg20261030021234zeHyJ1"}
{"level":"info","msg":"billing_callback_pending","traceId":"dcb7c57a-98be-4408-8ddd-9882261f4dae","stage":"credit","providerEventId":"f05-72fd9e72-00e4-4e8f-b460-9aab790b8aae","orderNo":"bg20261030021234zeHyJ1"}
{"level":"info","msg":"billing_callback_pending","traceId":"51d2d141-3ea8-41a3-a9bd-1fa66e3bce61","stage":"credit","providerEventId":"f05-72fd9e72-00e4-4e8f-b460-9aab790b8aae","orderNo":"bg20261030021234zeHyJ1"}
{"level":"info","msg":"billing_callback_pending","traceId":"217b220b-336e-4b6f-8164-c36a007a913f","stage":"credit","providerEventId":"f05-72fd9e72-00e4-4e8f-b460-9aab790b8aae","orderNo":"bg20261030021234zeHyJ1"}
{"level":"info","msg":"billing_callback_pending","traceId":"2c21be16-84d5-4c93-96ec-cb015e6e9481","stage":"credit","providerEventId":"f05-72fd9e72-00e4-4e8f-b460-9aab790b8aae","orderNo":"bg20261030021234zeHyJ1"}
{"level":"error","msg":"billing_callback_failed","traceId":"ef0f3f2f-8d45-4e2c-a643-5fa65ec0b149","detail":{"stage":"accept","code":"23505","providerEventId":"f05-8581fd6e-297c-445d-9fa2-c72880ca27f9","orderNo":"bg202610300212353zERJu"}}
{"level":"info","msg":"billing_late_paid_order","traceId":"f05-35e80206-8875-4909-9a05-7ddf58778a0a","orderNo":"bg20261030021235aPw3eo"}
{"level":"info","msg":"database_connection_error","traceId":"database","code":"unknown"}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-68bea50d-2fbc-45d9-93d0-32b78ab6113b","detail":{"providerEventId":"f05-68bea50d-2fbc-45d9-93d0-32b78ab6113b","code":"57P01"}}
{"level":"info","msg":"billing_callback_pending","traceId":"2019a875-eeb4-4656-974c-ffeef5a39c26","stage":"credit","providerEventId":"f05-68bea50d-2fbc-45d9-93d0-32b78ab6113b","orderNo":"bg20261030021235fN5XBV"}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-e2951c7e-e757-405e-914d-3812e02a29ed","detail":{"providerEventId":"f05-e2951c7e-e757-405e-914d-3812e02a29ed","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-c407540d-6f58-443b-88d8-d79605050455","detail":{"providerEventId":"f05-c407540d-6f58-443b-88d8-d79605050455","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-fcc9b2b7-ff9c-40fe-8eb1-0949a5226115","detail":{"providerEventId":"f05-fcc9b2b7-ff9c-40fe-8eb1-0949a5226115","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-20c13834-619d-4634-91c1-054ead02cc44","detail":{"providerEventId":"f05-20c13834-619d-4634-91c1-054ead02cc44","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-6a2d3899-0e71-4b4a-9091-fd0e64c6322a","detail":{"providerEventId":"f05-6a2d3899-0e71-4b4a-9091-fd0e64c6322a","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-3a536634-2b51-4554-9677-e73cd9c46a48","detail":{"providerEventId":"f05-3a536634-2b51-4554-9677-e73cd9c46a48","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-b0a35791-4be7-495e-a824-8d620cc4933e","detail":{"providerEventId":"f05-b0a35791-4be7-495e-a824-8d620cc4933e","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-d7a40874-1952-4b28-b042-621f465b449a","detail":{"providerEventId":"f05-d7a40874-1952-4b28-b042-621f465b449a","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-b117ec14-10fe-4ffe-9116-1abaf0932a72","detail":{"providerEventId":"f05-b117ec14-10fe-4ffe-9116-1abaf0932a72","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-87449f8b-49c9-4283-b471-9f270f4b067d","detail":{"providerEventId":"f05-87449f8b-49c9-4283-b471-9f270f4b067d","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-e2951c7e-e757-405e-914d-3812e02a29ed","detail":{"providerEventId":"f05-e2951c7e-e757-405e-914d-3812e02a29ed","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-c407540d-6f58-443b-88d8-d79605050455","detail":{"providerEventId":"f05-c407540d-6f58-443b-88d8-d79605050455","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-fcc9b2b7-ff9c-40fe-8eb1-0949a5226115","detail":{"providerEventId":"f05-fcc9b2b7-ff9c-40fe-8eb1-0949a5226115","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-20c13834-619d-4634-91c1-054ead02cc44","detail":{"providerEventId":"f05-20c13834-619d-4634-91c1-054ead02cc44","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-6a2d3899-0e71-4b4a-9091-fd0e64c6322a","detail":{"providerEventId":"f05-6a2d3899-0e71-4b4a-9091-fd0e64c6322a","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-3a536634-2b51-4554-9677-e73cd9c46a48","detail":{"providerEventId":"f05-3a536634-2b51-4554-9677-e73cd9c46a48","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-b0a35791-4be7-495e-a824-8d620cc4933e","detail":{"providerEventId":"f05-b0a35791-4be7-495e-a824-8d620cc4933e","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-d7a40874-1952-4b28-b042-621f465b449a","detail":{"providerEventId":"f05-d7a40874-1952-4b28-b042-621f465b449a","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-b117ec14-10fe-4ffe-9116-1abaf0932a72","detail":{"providerEventId":"f05-b117ec14-10fe-4ffe-9116-1abaf0932a72","code":"event_conflict"}}
{"level":"error","msg":"billing_receipt_recovery_required","traceId":"f05-87449f8b-49c9-4283-b471-9f270f4b067d","detail":{"providerEventId":"f05-87449f8b-49c9-4283-b471-9f270f4b067d","code":"event_conflict"}}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-87efb5ae-9cdc-44e3-bec9-222b4f6b677c","orderNo":"bg20261030021242hk9Iju","reason":"wallet_limit"}
 ✓ tests/billing/wechat-notify-crediting.test.ts (11 tests) 8209ms
   ✓ F05 durable idempotent PostgreSQL crediting > recovers a connection crash before commit from a durable receipt after a new app/pool starts 6192ms
   ✓ F05 durable idempotent PostgreSQL crediting > does not let ten conflicting receipts starve a later valid crash-recovery receipt 470ms
stdout | tests/billing/wallet-ledger-query.test.ts
[F03 HTTP fixture] starting database readiness

stdout | tests/billing/wallet-ledger-query.test.ts
[F03 HTTP fixture] database ready; creating Nest fixture
[F03 HTTP fixture] Nest created; binding loopback listener
[F03 HTTP fixture] listener ready

 ✓ tests/billing/wallet-ledger-query.test.ts (9 tests) 662ms
{"level":"info","msg":"billing_orders_expired","traceId":"billing-order-expiry:e029f622-ee21-46d5-914e-d893e21fe15a","closedCount":1}
{"level":"error","msg":"billing_order_expiry_failed","traceId":"billing-order-expiry:a23af0b5-2cd5-4d9c-b212-633582ac345b","detail":{"stage":"expiry_sweep","code":"other"}}
{"level":"info","msg":"billing_orders_expired","traceId":"billing-order-expiry:8eec64be-4e26-4cfa-a44a-79436660e55e","closedCount":2}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"billing_late_paid_order","traceId":"f05-cbcc1fdf-a20d-4389-9aed-343991cf3f0a","orderNo":"bg2026101600000023924a"}
{"level":"info","msg":"billing_late_paid_order","traceId":"f05-9334261e-d713-4d8e-9d7d-174aa8eee4fe","orderNo":"bg202610160000006a9dff"}
 ✓ tests/billing/order-close-task.test.ts (10 tests) 2501ms
   ✓ F07 actual PostgreSQL expiry and payment races > closes only expired PENDING snapshots, stamps closure once and exposes CLOSED through the real API 371ms
   ✓ F07 actual PostgreSQL expiry and payment races > bounds each sweep to 100 orders and catches remaining work on a subsequent sweep 446ms
   ✓ F07 actual PostgreSQL expiry and payment races > honors a genuine payment after closure and does not double credit it 319ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"instance telemetry disabled (endpoint_unset)","traceId":"instance-telemetry"}
{"level":"info","msg":"dev-process projection sync disabled (WSX_DEV_PROJECTION_SYNC_ORG unset)","traceId":"dev-process-projection-sync"}
{"level":"info","msg":"kg embedding worker not started: no embedding model configured; memory recall uses text + graph only","traceId":"kg-embedding","code":"embedding_not_configured"}
{"level":"error","msg":"http exception","traceId":"a1839cfe-63e9-49ea-b318-b5cf5a9fb68c","detail":{"name":"UnauthorizedException","message":"unauthenticated","stack":"UnauthorizedException: unauthenticated\n    at PrincipalGuard.canActivate (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/guards/principal.guard.ts:54:27)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
 ✓ tests/billing/billing-config.test.ts (21 tests) 11092ms
 ✓ tests/billing/credit-model-pg.integration.test.ts (4 tests) 880ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"http exception","traceId":"67e43e12-4a0b-4468-b772-14fbc78be893","detail":{"name":"UnauthorizedException","message":"unauthenticated","stack":"UnauthorizedException: unauthenticated\n    at PrincipalGuard.canActivate (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/guards/principal.guard.ts:54:27)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"contract validation failed","traceId":"a696e709-bfdf-4725-be20-37eb9e5e3da3","detail":{"name":"ContractValidationError","message":"validation_failed","stack":"ContractValidationError: validation_failed\n    at ZodBodyPipe.transform (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/pipes/zod-body.pipe.ts:41:11)\n    at /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/node_modules/.pnpm/@nestjs+core@10.4.22_@nestjs+common@10.4.22_class-transformer@0.5.1_class-validator@0.14.4_re_sgffei4zmw63aa4v2dkhbu25m4/node_modules/@nestjs/core/pipes/pipes-consumer.js:16:33\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"d30d785f-cbe5-43d0-9981-c42871427b4d","detail":{"stage":"http","reason":"upstream_http_error","status":500,"orderNo":"bg20261030021301TOUoMz"}}
{"level":"error","msg":"http exception","traceId":"d30d785f-cbe5-43d0-9981-c42871427b4d","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"9d7ba590-4732-4072-93db-0d441cdf16e5","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030021301FnsgXQ"}}
{"level":"error","msg":"http exception","traceId":"9d7ba590-4732-4072-93db-0d441cdf16e5","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"00be41ce-a4d8-4ccb-97f1-8862c0602c5c","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030021301upm2xz"}}
{"level":"error","msg":"http exception","traceId":"00be41ce-a4d8-4ccb-97f1-8862c0602c5c","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"8e6647c9-1848-41af-be06-cb333fe27e71","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030021301bkWcDa"}}
{"level":"error","msg":"http exception","traceId":"8e6647c9-1848-41af-be06-cb333fe27e71","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"a586030c-2cac-4634-9df3-d93c647b40a0","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030021301sZ1Pr3"}}
{"level":"error","msg":"http exception","traceId":"a586030c-2cac-4634-9df3-d93c647b40a0","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"6343b3fa-47ce-48a3-861d-00065f620fda","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030021301oWQDzn"}}
{"level":"error","msg":"http exception","traceId":"6343b3fa-47ce-48a3-861d-00065f620fda","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"456c7be1-c9b4-4442-a10c-b0d9dcd46b3f","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg202610300213010cQah1"}}
{"level":"error","msg":"http exception","traceId":"456c7be1-c9b4-4442-a10c-b0d9dcd46b3f","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"20e0ace4-9d07-47a6-ac27-a100eee07ceb","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg202610300213023tOKn2"}}
{"level":"error","msg":"http exception","traceId":"20e0ace4-9d07-47a6-ac27-a100eee07ceb","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"81eecdce-8991-4247-829e-717dfe1f3f51","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030021302bmQKxf"}}
{"level":"error","msg":"http exception","traceId":"81eecdce-8991-4247-829e-717dfe1f3f51","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"a0296593-870b-47ec-ab6e-50625bc90c81","detail":{"stage":"qr","reason":"response_qr_invalid","status":200,"orderNo":"bg20261030021302JYODLq"}}
{"level":"error","msg":"http exception","traceId":"a0296593-870b-47ec-ab6e-50625bc90c81","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"41ebb7e5-9347-41e3-8d22-eb87610aa7af","detail":{"stage":"qr","reason":"response_qr_invalid","status":200,"orderNo":"bg20261030021302gVaqzf"}}
{"level":"error","msg":"http exception","traceId":"41ebb7e5-9347-41e3-8d22-eb87610aa7af","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"c1290797-3284-4088-8d60-4fcdefebf796","detail":{"stage":"json","reason":"response_json_invalid","status":200,"orderNo":"bg20261030021302N48EEE"}}
{"level":"error","msg":"http exception","traceId":"c1290797-3284-4088-8d60-4fcdefebf796","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"7ec64818-d232-4e93-97fa-569b483b2069","detail":{"stage":"request","reason":"request_failed","orderNo":"bg20261030021302w6Ob6W"}}
{"level":"error","msg":"http exception","traceId":"7ec64818-d232-4e93-97fa-569b483b2069","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"514e0094-9b97-4f3f-b9fc-04c0dd6c084b","detail":{"stage":"body","reason":"response_body_invalid","status":200,"orderNo":"bg20261030021302hkR0fs"}}
{"level":"error","msg":"http exception","traceId":"514e0094-9b97-4f3f-b9fc-04c0dd6c084b","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_native_failed","traceId":"d30d3514-e938-4522-b6e0-d4366dbf5afe","detail":{"stage":"request","reason":"request_timeout","orderNo":"bg20261030021302NKx9pP"}}
{"level":"error","msg":"http exception","traceId":"d30d3514-e938-4522-b6e0-d4366dbf5afe","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_native_failed","traceId":"9c132937-0110-4023-b80b-c04c8a5b3570","detail":{"stage":"body","reason":"request_timeout","status":200,"orderNo":"bg20261030021310xefmNg"}}
{"level":"error","msg":"http exception","traceId":"9c132937-0110-4023-b80b-c04c8a5b3570","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"c722cc69-c8d8-4e3f-9d05-03ea8d410c1c","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"unhandled exception","traceId":"d2b35c51-f025-435d-9d92-cd0f1bc50157","detail":{"name":"error","message":"insert or update on table \"billing_orders\" violates foreign key constraint \"billing_orders_package_id_fkey\"","stack":"error: insert or update on table \"billing_orders\" violates foreign key constraint \"billing_orders_package_id_fkey\"\n    at /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/client.js:652:17\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)\n    at Object.query (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/infrastructure/db/pg-database.ts:62:21)\n    at /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/infrastructure/billing/pg-billing-order-repository.ts:37:22\n    at PgDatabase.inTx (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/infrastructure/db/pg-database.ts:74:19)\n    at BillingOrderService.create (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/application/billing/billing-order-service.ts:80:61)\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:14:18)"}}
{"level":"error","msg":"http exception","traceId":"f6f08e09-d522-4590-9f24-979706ba3970","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"c980033e-45d6-4f35-9ec9-1fb3fdcd2626","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"1bd229bd-e7da-452f-930b-290560bf6b4b","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
 ✓ tests/billing/order-core.test.ts (26 tests) 18507ms
   ✓ F04 real Native order HTTP and PostgreSQL > does not persist a fake order on timeout-headers 8087ms
   ✓ F04 real Native order HTTP and PostgreSQL > does not persist a fake order on timeout-body 8196ms
 ✓ tests/billing/credit-period-lifecycle-pg.test.ts (6 tests) 1199ms
 ✓ tests/billing/credit-stream-settlement.test.ts (4 tests) 793ms
 ✓ tests/billing/private-auxiliary-credit-pg.test.ts (5 tests) 779ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"billing_late_paid_order","traceId":"f05-66d4e4e9-4e1c-4e3f-9766-ba043ee5da49","orderNo":"bg202610300213250rIcq9"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-ca17495f-6c52-4e09-9e7d-496724360f81","orderNo":"bg20261030021326GnlmrK","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-2be46aff-131c-43db-b443-a3b3042319d8","orderNo":"bg20261030021326IYucwE","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-2797c908-6599-41e0-974a-30bc0ddcc834","orderNo":"bg202610300213261SI12l","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-62deb556-6bbb-45ba-9240-4dd5914b34d8","orderNo":"bg20261030021326MxDqA7","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-b1cfc87f-064f-407f-bc06-d746b458122a","orderNo":"bg20261030021327gpUQXw","reason":"wallet_limit"}
{"level":"info","msg":"billing_payment_manual_recovery","traceId":"f05-b2072aa9-37b4-4c92-91ba-6920470fa4d6","orderNo":"bg20261030021327SqOcEe","reason":"wallet_limit"}
 ✓ tests/billing/wechat-notify-outcomes.test.ts (8 tests) 3049ms
   ✓ F05 terminal timestamps and durable paid-funds recovery > keeps acceptance timestamps null for CLOSED until successful crediting 607ms
   ✓ F05 terminal timestamps and durable paid-funds recovery > durably records PENDING paid funds exceeding balance capacity without partial credit 469ms
 ✓ tests/billing/subscription-credit-backfill.test.ts (6 tests) 885ms
 ✓ tests/billing/credit-model-gateway.test.ts (10 tests) 13ms
 ✓ tests/billing/credit-admission-policy-pg.test.ts (6 tests) 1695ms
 ✓ tests/billing/personal-credit-usage.test.ts (3 tests) 1015ms
 ✓ tests/billing/consumption-settings.test.ts (4 tests) 292ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
 ✓ tests/billing/wechat-notify-verify.test.ts (13 tests) 6355ms
   ✓ F05 raw WeChat callback cryptographic boundary > rejects tampered before crediting, without poisoning the real event id 496ms
   ✓ F05 raw WeChat callback cryptographic boundary > rejects missing-signature before crediting, without poisoning the real event id 1445ms
   ✓ F05 raw WeChat callback cryptographic boundary > rejects missing-nonce before crediting, without poisoning the real event id 349ms
   ✓ F05 raw WeChat callback cryptographic boundary > rejects stale before crediting, without poisoning the real event id 334ms
   ✓ F05 raw WeChat callback cryptographic boundary > rejects unknown-key before crediting, without poisoning the real event id 307ms
   ✓ F05 raw WeChat callback cryptographic boundary > rejects wrong-rsa before crediting, without poisoning the real event id 670ms
   ✓ F05 raw WeChat callback cryptographic boundary > does not trust a valid outer signature when AES-GCM authentication fails 359ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"http exception","traceId":"5c2bb710-d5f3-44c5-ba7f-a442f09d5933","detail":{"name":"UnauthorizedException","message":"unauthenticated","stack":"UnauthorizedException: unauthenticated\n    at PrincipalGuard.canActivate (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/guards/principal.guard.ts:54:27)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"9e32d79a-b424-4727-b2bc-4abaf1db4ec5","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"0f9f5fd3-4a52-4491-b896-df2f40206978","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_close_failed","traceId":"07a4e08e-d0c8-4db0-b240-9c7623257138","detail":{"orderNo":"bg20261030021349U3tkHQ","reason":"merchant_closure_unconfirmed"}}
{"level":"error","msg":"http exception","traceId":"07a4e08e-d0c8-4db0-b240-9c7623257138","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_close_failed","traceId":"abaa0915-b352-43c2-ace8-26067ac0b20f","detail":{"orderNo":"bg20261030021349yCH8Cj","reason":"merchant_closure_unconfirmed"}}
{"level":"error","msg":"http exception","traceId":"abaa0915-b352-43c2-ace8-26067ac0b20f","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"32801461-1c08-4224-b68c-c60e0fe12b98","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"ef4d8ea2-f09a-4190-8b76-979c5bbe7c65","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
 ✓ tests/billing/order-cancel.test.ts (8 tests) 5329ms
   ✓ authenticated unpaid order cancellation > closes the merchant order before persisting CLOSED and is idempotent 608ms
   ✓ authenticated unpaid order cancellation > preserves the order on merchant paid 302ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"http exception","traceId":"b339faca-23f8-4440-bfc9-7925d8d39bea","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"contract validation failed","traceId":"f677b678-1c0c-43e0-820b-a742c16317c3","detail":{"name":"ContractValidationError","message":"validation_failed","stack":"ContractValidationError: validation_failed\n    at ZodBodyPipe.transform (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/pipes/zod-body.pipe.ts:41:11)\n    at /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/node_modules/.pnpm/@nestjs+core@10.4.22_@nestjs+common@10.4.22_class-transformer@0.5.1_class-validator@0.14.4_re_sgffei4zmw63aa4v2dkhbu25m4/node_modules/@nestjs/core/pipes/pipes-consumer.js:16:33\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"9b0ae7c5-16bf-4eb7-952d-8ac006baa294","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"ec2b0a36-821d-4fca-9c48-c394603f2dae","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"9ba9de4a-bb2e-406e-a04c-03484cbead0c","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"774e90b7-572b-40a4-962e-6f0c435945c8","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"deeb412f-7fd5-4ac2-82ab-05ae9c1a8f16","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"http exception","traceId":"9b55d6df-325c-44ea-9421-da78865cddae","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
 ✓ tests/billing/order-ownership.test.ts (6 tests) 1203ms
 ✓ tests/billing/wechat-notify-observability.test.ts (4 tests) 2ms
 ✓ tests/billing/native-credit-tariff-pg.test.ts (3 tests) 350ms
 ✓ tests/billing/chat-read-asr-credit-fixture.test.ts (2 tests) 372ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
 ✓ tests/billing/wechat-reference-compatibility.test.ts (5 tests) 1024ms
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_native_failed","traceId":"0c8a91b6-e5e9-4f94-ac57-548452f5e0d4","detail":{"stage":"json","reason":"response_json_invalid","status":200,"orderNo":"bg20261030021356pTep2s"}}
{"level":"error","msg":"http exception","traceId":"0c8a91b6-e5e9-4f94-ac57-548452f5e0d4","detail":{"name":"BillingHttpException","message":"Billing Http Exception","stack":"BillingHttpException: Billing Http Exception\n    at BillingOrderController.mapped (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api/src/interface/controllers/billing-order.controller.ts:19:15)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)"}}
{"level":"error","msg":"billing_native_failed","traceId":"native-safe-trace","detail":{"stage":"http","reason":"upstream_http_error","status":500,"orderNo":"bg20261030021356udcbTY"}}
{"level":"error","msg":"billing_native_failed","traceId":"native-safe-trace","detail":{"stage":"signature","reason":"response_signature_invalid","status":200,"orderNo":"bg20261030021356gBo2rD"}}
{"level":"error","msg":"billing_native_failed","traceId":"native-safe-trace","detail":{"stage":"json","reason":"response_json_invalid","status":200,"orderNo":"bg202610300213562U9oG1"}}
{"level":"info","msg":"credit_receipts_pending","traceId":"credit-receipt-replay","pending":1}
{"level":"error","msg":"billing_native_failed","traceId":"native-safe-trace","detail":{"stage":"request","reason":"request_timeout","orderNo":"bg20261030021356OHezWV"}}
 ✓ tests/billing/native-failure-diagnostics.test.ts (5 tests) 8912ms
   ✓ Native merchant failure diagnostics > retains safe timeout-headers cause and trace without signed bodies or credentials 8072ms
 ✓ tests/billing/native-read-deadline.test.ts (2 tests) 14ms
 ✓ tests/billing/consumption-settings-pg.test.ts (2 tests) 226ms
 ✓ tests/auth/ai-usage-scope.test.ts (4 tests) 4ms
 ✓ tests/billing/credit-error-boundary.test.ts (3 tests) 4ms
 ✓ tests/billing/reference-package-catalog.test.ts (2 tests) 247ms
 ✓ tests/billing/credit-periods-pg.test.ts (1 test) 283ms
 ✓ tests/billing/global-error-boundary.test.ts (4 tests) 5ms
 ✓ tests/billing/credit-execution-context.test.ts (2 tests) 11ms
 ✓ tests/billing/private-credit-failure.test.ts (3 tests) 9ms
 ✓ tests/billing/credit-auxiliary-errors.test.ts (3 tests) 2ms
 ✓ tests/billing/billing-global-boundary.test.ts (9 tests) 3ms
 ✓ tests/billing/credit-run-error-contract.test.ts (1 test) 188ms

 Test Files  41 passed (41)
      Tests  338 passed (338)
   Start at  10:11:30
   Duration  158.20s (transform 9.01s, setup 186ms, collect 22.87s, tests 122.73s, environment 4ms, prepare 1.68s)

[db-isolation] db=wsx_cf9023fcb7cb0fdcafdb peak_connections=9
[timing] pnpm --filter @repo/api exec vitest run tests/billing tests/auth/ai-usage-repository.test.ts tests/auth/ai-usage-scope.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：2m39s
  清理：0s
  总计：2m40s
