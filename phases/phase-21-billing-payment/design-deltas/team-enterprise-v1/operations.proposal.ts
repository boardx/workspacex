/** Unsigned design proposal for #6099. Promote each operation into billing-team with its implemented route after bundle signoff. */
import {z} from "zod";
import {BillingErrorCode} from "../../../../packages/contracts/src/billing-credits";
import {SubscriptionLink} from "../../../../packages/contracts/src/billing-subscription";
import {OrganizationPlanErrorCode} from "../../../../packages/contracts/src/organization-plan";
import {TeamBillingErrorCode,TeamCatalog,TeamEntitlement,TeamQuoteRequest,TeamQuote,TeamCheckoutRequest,TeamPurchaseOutcome,TeamHistoryQuery,TeamSubscriptionHistory,EnterpriseUpgradeRequest,EnterpriseUpgradeOperation,EnterpriseCreditGrantRequest,EnterpriseCreditGrantResult} from "../../../../packages/contracts/src/billing-team";
const Identifier=EnterpriseCreditGrantResult.shape.orgId;
const OrgPath=z.object({orgId:Identifier}).strict();
const ReadErrors=[BillingErrorCode.enum.forbidden,BillingErrorCode.enum.owner_not_found,"dependency_unavailable"] as const;
const SaleErrors=TeamBillingErrorCode.options;
export const operations={
 getTeamCatalog:{method:"GET",path:"/billing/organizations/:orgId/catalog",in:OrgPath,out:TeamCatalog,err:ReadErrors},
 getTeamEntitlement:{method:"GET",path:"/billing/organizations/:orgId/entitlement",in:OrgPath,out:TeamEntitlement,err:ReadErrors},
 createTeamQuote:{method:"POST",path:"/billing/organizations/:orgId/quotes",in:TeamQuoteRequest,out:TeamQuote,err:SaleErrors},
 createTeamCheckout:{method:"POST",path:"/billing/organizations/:orgId/checkout",in:TeamCheckoutRequest,out:TeamPurchaseOutcome,err:SaleErrors},
 getTeamPurchase:{method:"GET",path:"/billing/organizations/:orgId/purchases/:purchaseRef",in:OrgPath.extend({purchaseRef:Identifier}),out:TeamPurchaseOutcome,err:[...ReadErrors,BillingErrorCode.enum.order_not_found] as const},
 getTeamHistory:{method:"GET",path:"/billing/organizations/:orgId/history",in:TeamHistoryQuery.extend({orgId:Identifier}),out:TeamSubscriptionHistory,err:ReadErrors},
 manageTeamSubscription:{method:"POST",path:"/billing/organizations/:orgId/subscription/manage",in:z.object({}).strict(),out:SubscriptionLink,err:[...ReadErrors,"not_subscribed", "payment_provider_not_configured"] as const},
 createEnterpriseUpgrade:{method:"POST",path:"/platform/organizations/:orgId/billing/enterprise-upgrades",in:EnterpriseUpgradeRequest,out:EnterpriseUpgradeOperation,err:SaleErrors},
 getEnterpriseUpgradeOperation:{method:"GET",path:"/platform/organizations/:orgId/billing/operations/:operationRef",in:OrgPath.extend({operationRef:Identifier}),out:EnterpriseUpgradeOperation,err:[...OrganizationPlanErrorCode.options,"dependency_unavailable",BillingErrorCode.enum.order_not_found] as const},
 grantEnterpriseCredits:{method:"POST",path:"/platform/organizations/:orgId/billing/credit-grants",in:EnterpriseCreditGrantRequest,out:EnterpriseCreditGrantResult,err:SaleErrors},
} as const;
