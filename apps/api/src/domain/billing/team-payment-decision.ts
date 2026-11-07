import type {TeamPurchaseFacts} from "./team-purchase";
import {firstTeamGrant} from "./team-purchase";
export type VerifiedTeamPayment={provider:"wechat"|"stripe";purchaseRef:string;paymentRef:string;amountMinor:number;currency:string;paidAt:Date};
export type TeamSettlementFacts={plan:string;planVersion:number;pendingPurchaseRef:string|null;memberCount:number};
/** Trusted cash is retained for reconciliation when commercial application is unsafe. */
export function assessTeamPayment(p:TeamPurchaseFacts,payment:VerifiedTeamPayment,f:TeamSettlementFacts,appliedAt:Date){
 const q=p.quote;
 const review=(reason:string)=>({kind:"review" as const,reason,payment});
 if(payment.purchaseRef!==p.purchaseRef||payment.provider!==q.provider||payment.currency!==q.currency||payment.amountMinor!==q.amountMinor)return review("receipt_mismatch");
 if(!Number.isFinite(payment.paidAt.getTime())||payment.paidAt.getTime()<Math.floor(p.createdAt.getTime()/1000)*1000||payment.paidAt>=p.checkoutExpiresAt||payment.paidAt>appliedAt)return review("payment_time_requires_review");
 if(q.purpose!=="credit_topup"){
  if(q.purpose==="add_seats")return review("unsupported_plan_transition");
  if(f.plan==="enterprise"||f.planVersion!==q.planVersion||f.pendingPurchaseRef!==p.purchaseRef)return review("commercial_version_changed");
  if(f.memberCount>q.seats)return review("capacity_insufficient");
 }
 return {kind:"apply" as const,payment,grant:firstTeamGrant(q,payment.paidAt,appliedAt)};
}
