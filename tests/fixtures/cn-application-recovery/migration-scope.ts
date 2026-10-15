import assert from 'node:assert/strict';
// Reviewed additive suffix; the historical recovery prefix remains unchanged.
export const reviewedSuffix = [
 '20261006001000_organization_creation_requests.sql',
 '20261013010000_chat_public_shares.sql',
 '20261013070000_report_skill_files.sql',
 '20261014010000_interview_custom_expert_library.sql',
 '20261015120000_billing_payment_receipts.sql',
];
export function migrationScope(names:string[]) {
 assert.deepEqual(names,[...new Set(names)].sort(),'SORTED_UNIQUE_MIGRATIONS_REQUIRED');
 const originalCount=names.indexOf(reviewedSuffix[0]!);
 assert(originalCount>0,'HISTORICAL_RECOVERY_BOUNDARY_REQUIRED');
 assert.deepEqual(names.slice(originalCount),reviewedSuffix,'UNREVIEWED_MIGRATION_SUFFIX');
 return {originalCount,pending:[...reviewedSuffix],last:names.at(-1)!};
}
