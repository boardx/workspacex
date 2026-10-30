TAP version 13
# Subtest: actual migration catalog keeps the historical prefix and includes every reviewed new migration
not ok 1 - actual migration catalog keeps the historical prefix and includes every reviewed new migration
  ---
  duration_ms: 1.942459
  location: '/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/tests/fixtures/cn-application-recovery/migration-scope.test.ts:1:206'
  failureType: 'testCodeFailure'
  error: |-
    UNREVIEWED_MIGRATION_SUFFIX
    + actual - expected
    ... Skipped lines

      [
        '20261006001000_organization_creation_requests.sql',
        '20261013010000_chat_public_shares.sql',
        '20261013070000_report_skill_files.sql',
        '20261014010000_interview_custom_expert_library.sql',
    ...
        '20261023130000_private_auxiliary_model_operations.sql',
    +   '20261030010000_credit_subscription_periods.sql'
      ]

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
    0: '20261006001000_organization_creation_requests.sql'
    1: '20261013010000_chat_public_shares.sql'
    2: '20261013070000_report_skill_files.sql'
    3: '20261014010000_interview_custom_expert_library.sql'
    4: '20261015120000_billing_payment_receipts.sql'
    5: '20261018090000_billing_subscription_links.sql'
    6: '20261021100000_billing_stripe_webhook.sql'
    7: '20261021140000_wechat_reference_compatibility.sql'
    8: '20261022023000_billing_reference_packages.sql'
    9: '20261022110000_credit_consumption_settings.sql'
    10: '20261022120000_credit_consumption.sql'
    11: '20261022150000_credit_run_errors.sql'
    12: '20261023010000_credit_native_tariff_audit.sql'
    13: '20261023110000_knowledge_embedding_accounting.sql'
    14: '20261023120000_auxiliary_model_accounting.sql'
    15: '20261023130000_private_auxiliary_model_operations.sql'
  actual:
    0: '20261006001000_organization_creation_requests.sql'
    1: '20261013010000_chat_public_shares.sql'
    2: '20261013070000_report_skill_files.sql'
    3: '20261014010000_interview_custom_expert_library.sql'
    4: '20261015120000_billing_payment_receipts.sql'
    5: '20261018090000_billing_subscription_links.sql'
    6: '20261021100000_billing_stripe_webhook.sql'
    7: '20261021140000_wechat_reference_compatibility.sql'
    8: '20261022023000_billing_reference_packages.sql'
    9: '20261022110000_credit_consumption_settings.sql'
    10: '20261022120000_credit_consumption.sql'
    11: '20261022150000_credit_run_errors.sql'
    12: '20261023010000_credit_native_tariff_audit.sql'
    13: '20261023110000_knowledge_embedding_accounting.sql'
    14: '20261023120000_auxiliary_model_accounting.sql'
    15: '20261023130000_private_auxiliary_model_operations.sql'
    16: '20261030010000_credit_subscription_periods.sql'
  operator: 'deepStrictEqual'
  stack: |-
    migrationScope (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/tests/fixtures/cn-application-recovery/migration-scope.ts:25:9)
    TestContext.<anonymous> (/Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/tests/fixtures/cn-application-recovery/migration-scope.test.ts:6:37)
    Test.runInAsyncScope (node:async_hooks:211:14)
    Test.run (node:internal/test_runner/test:979:25)
    Test.start (node:internal/test_runner/test:877:17)
    startSubtestAfterBootstrap (node:internal/test_runner/harness:296:17)
  ...
# Subtest: future or missing migrations cannot silently alter the tested upgrade
ok 2 - future or missing migrations cannot silently alter the tested upgrade
  ---
  duration_ms: 0.758125
  ...
1..2
# tests 2
# suites 0
# pass 1
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 275.5745
