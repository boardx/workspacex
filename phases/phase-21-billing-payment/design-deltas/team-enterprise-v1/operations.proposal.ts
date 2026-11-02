/** Remaining signed design metadata for #6099. Implemented routes reuse runtime operations; unimplemented routes remain proposals. */
import {BillingErrorCode} from "../../../../packages/contracts/src/billing-credits";
import {SubscriptionLink} from "../../../../packages/contracts/src/billing-subscription";
import {OrganizationPlanErrorCode} from "../../../../packages/contracts/src/organization-plan";
import {operations as implementedTeamOperations,TeamBillingErrorCode,TeamCatalog,TeamEntitlement,TeamQuoteRequest,TeamQuote,TeamCheckoutRequest,TeamPurchaseOutcome,TeamHistoryQuery,TeamSubscriptionHistory,EnterpriseUpgradeRequest,EnterpriseUpgradeOperation,EnterpriseCreditGrantRequest,EnterpriseCreditGrantResult} from "../../../../packages/contracts/src/billing-team";
const Identifier=EnterpriseCreditGrantResult.shape.orgId;
const OrgPath=EnterpriseCreditGrantResult.pick({orgId:true});
const ReadErrors=[BillingErrorCode.enum.forbidden,BillingErrorCode.enum.owner_not_found,"dependency_unavailable"] as const;
const SaleErrors=TeamBillingErrorCode.options;
export const operations={
 ...implementedTeamOperations,
 getTeamHistory:{method:"GET",path:"/billing/organizations/:orgId/history",in:TeamHistoryQuery.extend({orgId:Identifier}),out:TeamSubscriptionHistory,err:ReadErrors},
 manageTeamSubscription:{method:"POST",path:"/billing/organizations/:orgId/subscription/manage",in:OrgPath.omit({orgId:true}),out:SubscriptionLink,err:[...ReadErrors,"not_subscribed", "payment_provider_not_configured"] as const},
 createEnterpriseUpgrade:{method:"POST",path:"/platform/organizations/:orgId/billing/enterprise-upgrades",in:EnterpriseUpgradeRequest,out:EnterpriseUpgradeOperation,err:SaleErrors},
 getEnterpriseUpgradeOperation:{method:"GET",path:"/platform/organizations/:orgId/billing/operations/:operationRef",in:OrgPath.extend({operationRef:Identifier}),out:EnterpriseUpgradeOperation,err:[...OrganizationPlanErrorCode.options,"dependency_unavailable",BillingErrorCode.enum.order_not_found] as const},
 grantEnterpriseCredits:{method:"POST",path:"/platform/organizations/:orgId/billing/credit-grants",in:EnterpriseCreditGrantRequest,out:EnterpriseCreditGrantResult,err:SaleErrors},
} as const;
