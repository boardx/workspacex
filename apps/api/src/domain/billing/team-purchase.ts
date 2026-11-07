import {TeamProduct,TeamQuote,TeamQuoteRequest,TEAM_QUOTE_TTL_MS,type TeamPaidTerm} from "@repo/contracts/billing-team";
import {creditMonthBoundary,paidCreditMonthCount} from "@repo/contracts/billing-credit-calendar";
export type TeamPurchaseFacts=Readonly<{purchaseRef:string;quote:TeamQuote;createdAt:Date;checkoutExpiresAt:Date}>;
export type TeamQuoteContext={orgId:string;generation:string;quoteRef:string;catalogVersion:string;now:Date;memberCount:number;planVersion:number;plan:string;existingSeats:number|null;existingPaidUntil:Date|null};
/** Pure construction from the one configured catalog read; no browser-supplied financial facts. */
export function buildTeamQuote(raw:unknown,configured:unknown,c:TeamQuoteContext):TeamQuote{
 const request=TeamQuoteRequest.parse(raw),product=TeamProduct.parse(configured);
 if(request.sku!==product.sku||request.provider!=="wechat"||product.currency!=="CNY")throw Error("product_unavailable");
 if(request.catalogVersion!==c.catalogVersion)throw Error("catalog_changed");
 if(c.plan==="enterprise")throw Error("unsupported_plan_transition");
 const base={orgId:c.orgId,generation:c.generation,quoteRef:c.quoteRef,catalogVersion:c.catalogVersion,sku:product.sku,provider:request.provider,currency:product.currency,createdAt:c.now.toISOString(),expiresAt:new Date(c.now.getTime()+TEAM_QUOTE_TTL_MS).toISOString(),renewalMode:"manual"};
 if(request.purpose==="credit_topup"){
  if(product.kind!=="credit_topup")throw Error("product_unavailable");
  return TeamQuote.parse({...base,purpose:request.purpose,amountMinor:product.amountMinor,credits:product.credits});
 }
 if(request.purpose==="add_seats")throw Error("unsupported_plan_transition");
 if(product.kind!=="subscription")throw Error("product_unavailable");
 if(request.expectedPlanVersion!==c.planVersion)throw Error("PLAN_VERSION_CONFLICT");
 if(c.existingSeats!==null&&(!c.existingPaidUntil||!Number.isFinite(c.existingPaidUntil.getTime())))throw Error("dependency_unavailable");
 if(c.existingPaidUntil&&c.existingPaidUntil>c.now)throw Error("already_subscribed");
 if(request.purpose==="initial"&&c.existingSeats!==null||request.purpose==="renewal"&&c.existingSeats===null)throw Error("unsupported_plan_transition");
 if(request.seats<c.memberCount||request.seats<(c.existingSeats??0))throw Error("capacity_insufficient");
 const extra=request.seats-product.includedSeats;
 const amountMinor=product.amountMinor+extra*product.additionalSeatAmountMinor;
 const monthlyCredits=product.monthlyCredits+extra*product.additionalSeatMonthlyCredits;
 if(!Number.isSafeInteger(amountMinor)||!Number.isSafeInteger(monthlyCredits))throw Error("credit_balance_unrepresentable");
 return TeamQuote.parse({...base,purpose:request.purpose,amountMinor,seats:request.seats,monthlyCredits,billingCycle:product.cycle,planVersion:c.planVersion});
}
/** First grant always keeps its original month, even when provider recovery is late. */
export function firstTeamGrant(quote:TeamQuote,paidAt:Date,appliedAt:Date):{credits:number;term:TeamPaidTerm|null;period:{periodStart:string;periodEnd:string}|null}{
 if(!Number.isFinite(paidAt.getTime())||!Number.isFinite(appliedAt.getTime())||appliedAt<paidAt)throw Error("payment_review_required");
 if(quote.purpose==="credit_topup")return {credits:quote.credits,term:null,period:null};
 if(quote.purpose==="add_seats")throw Error("unsupported_plan_transition");
 const end=creditMonthBoundary(paidAt,1);
 return {credits:appliedAt<end?quote.monthlyCredits:0,period:{periodStart:paidAt.toISOString(),periodEnd:end.toISOString()},term:{purchaseAnchor:paidAt.toISOString(),paidPeriodStart:paidAt.toISOString(),paidPeriodEnd:creditMonthBoundary(paidAt,paidCreditMonthCount(quote.billingCycle)).toISOString(),billingCycle:quote.billingCycle,purchasedSeats:quote.seats,monthlyCredits:quote.monthlyCredits}};
}
