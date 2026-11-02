/** Signed design proposal for #6099. Implemented Enterprise operations reference the runtime contract; remaining Team routes await implementation. */
import {BillingErrorCode} from "../../../../packages/contracts/src/billing-credits";
import {SubscriptionLink} from "../../../../packages/contracts/src/billing-subscription";
import {OrganizationPlanErrorCode} from "../../../../packages/contracts/src/organization-plan";
import {TeamBillingErrorCode,TeamCatalog,TeamEntitlement,TeamQuoteRequest,TeamQuote,TeamCheckoutRequest,TeamPurchaseOutcome,TeamHistoryQuery,TeamSubscriptionHistory,operations as enterpriseOperations,EnterpriseCreditGrantResult} from "../../../../packages/contracts/src/billing-team";
const Identifier=EnterpriseCreditGrantResult.shape.orgId;
const OrgPath=EnterpriseCreditGrantResult.pick({orgId:true});
const ReadErrors=[BillingErrorCode.enum.forbidden,BillingErrorCode.enum.owner_not_found,"dependency_unavailable"] as const;
const SaleErrors=TeamBillingErrorCode.options;
export const operations={
 ...enterpriseOperations,
 getTeamCatalog:{method:"GET",path:"/billing/organizations/:orgId/catalog",in:OrgPath,out:TeamCatalog,err:ReadErrors},
 getTeamEntitlement:{method:"GET",path:"/billing/organizations/:orgId/entitlement",in:OrgPath,out:TeamEntitlement,err:ReadErrors},
 createTeamQuote:{method:"POST",path:"/billing/organizations/:orgId/quotes",in:TeamQuoteRequest,out:TeamQuote,err:SaleErrors},
 createTeamCheckout:{method:"POST",path:"/billing/organizations/:orgId/checkout",in:TeamCheckoutRequest,out:TeamPurchaseOutcome,err:SaleErrors},
 getTeamPurchase:{method:"GET",path:"/billing/organizations/:orgId/purchases/:purchaseRef",in:OrgPath.extend({purchaseRef:Identifier}),out:TeamPurchaseOutcome,err:[...ReadErrors,BillingErrorCode.enum.order_not_found] as const},
 getTeamHistory:{method:"GET",path:"/billing/organizations/:orgId/history",in:TeamHistoryQuery.extend({orgId:Identifier}),out:TeamSubscriptionHistory,err:ReadErrors},
 manageTeamSubscription:{method:"POST",path:"/billing/organizations/:orgId/subscription/manage",in:OrgPath.omit({orgId:true}),out:SubscriptionLink,err:[...ReadErrors,"not_subscribed", "payment_provider_not_configured"] as const},
} as const;
