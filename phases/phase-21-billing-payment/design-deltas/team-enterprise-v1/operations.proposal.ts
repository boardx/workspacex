/** Remaining signed design metadata for #6099. Implemented routes reuse runtime operations; unimplemented routes remain proposals. */
import {BillingErrorCode} from "../../../../packages/contracts/src/billing-credits";
import {SubscriptionLink} from "../../../../packages/contracts/src/billing-subscription";
import {operations as implementedOperations,TeamHistoryQuery,TeamSubscriptionHistory,EnterpriseCreditGrantResult} from "../../../../packages/contracts/src/billing-team";
const Identifier=EnterpriseCreditGrantResult.shape.orgId;
const OrgPath=EnterpriseCreditGrantResult.pick({orgId:true});
const ReadErrors=[BillingErrorCode.enum.forbidden,BillingErrorCode.enum.owner_not_found,"dependency_unavailable"] as const;
export const operations={
 ...implementedOperations,
 getTeamHistory:{method:"GET",path:"/billing/organizations/:orgId/history",in:TeamHistoryQuery.extend({orgId:Identifier}),out:TeamSubscriptionHistory,err:ReadErrors},
 manageTeamSubscription:{method:"POST",path:"/billing/organizations/:orgId/subscription/manage",in:OrgPath.omit({orgId:true}),out:SubscriptionLink,err:[...ReadErrors,"not_subscribed", "payment_provider_not_configured"] as const},
} as const;
