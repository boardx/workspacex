import assert from 'node:assert/strict';
// Reviewed additive suffix; the historical recovery prefix remains unchanged.
export const reviewedSuffix = [
 '20261006001000_organization_creation_requests.sql',
 '20261013010000_chat_public_shares.sql',
 '20261013070000_report_skill_files.sql',
 '20261014010000_interview_custom_expert_library.sql',
 '20261015120000_billing_payment_receipts.sql',
 '20261018090000_billing_subscription_links.sql',
 '20261021100000_billing_stripe_webhook.sql',
 '20261021140000_wechat_reference_compatibility.sql',
 '20261022023000_billing_reference_packages.sql',
 '20261022110000_credit_consumption_settings.sql',
 '20261022120000_credit_consumption.sql',
 '20261022150000_credit_run_errors.sql',
  "20261023010000_credit_native_tariff_audit.sql",
  "20261023110000_knowledge_embedding_accounting.sql",
  "20261023120000_auxiliary_model_accounting.sql",
];
export function migrationScope(names:string[]) {
 assert.deepEqual(names,[...new Set(names)].sort(),'SORTED_UNIQUE_MIGRATIONS_REQUIRED');
 const originalCount=names.indexOf(reviewedSuffix[0]!);
 assert(originalCount>0,'HISTORICAL_RECOVERY_BOUNDARY_REQUIRED');
 assert.deepEqual(names.slice(originalCount),reviewedSuffix,'UNREVIEWED_MIGRATION_SUFFIX');
 return {originalCount,pending:[...reviewedSuffix],last:names.at(-1)!};
}
