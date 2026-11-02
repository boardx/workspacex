import type {DatabasePort} from "../../application/ports/database.port";
import {toOrgId} from "../../domain/org-id";
import {closePendingCommercialIntent} from "../org-capacity/pg-commercial-capacity";
import {lockTeamFinancialOwner} from "./team-financial-owner";
import {requireActivePricingEpoch} from "./personal-pricing-epoch";
import {teamPurchaseView,type TeamPurchaseRow} from "./pg-team-checkout-repository";
import {PgTeamPaymentRepository} from "./pg-team-payment-repository";
import {TeamWechatPaymentClient} from "./team-wechat-payment-client";
/** Reconciliation reads provider authority outside database transactions. Never closes from a local clock alone. */
export class TeamPaymentReconciler{
 constructor(private readonly db:DatabasePort,private readonly client:TeamWechatPaymentClient,private readonly payments:PgTeamPaymentRepository){}
 async reconcile(orgId:string,purchaseRef:string){
  const p=await this.db.withTenant(toOrgId(orgId),async s=>{
   await requireActivePricingEpoch(s);const row=(await s.query<TeamPurchaseRow>("SELECT * FROM billing_team_purchases WHERE org_id=$1 AND purchase_ref=$2",[orgId,purchaseRef])).rows[0];
   if(!row)throw Error("order_not_found");return teamPurchaseView(row);
  });
  if(p.terminal)return;
  const state=await this.client.reconcile(p);
  if(state.state==="paid"){
   await this.payments.settle(orgId,{provider:"wechat",purchaseRef:p.purchaseRef,paymentRef:state.paymentRef,paidAt:state.paidAt,amountMinor:state.amountMinor,currency:state.currency});return;
  }
  if(state.state!=="closed")return;
  await this.db.withTenant(toOrgId(orgId),async s=>{
   const writable=await lockTeamFinancialOwner(s,orgId);await requireActivePricingEpoch(s);
   const row=(await s.query<TeamPurchaseRow>("SELECT * FROM billing_team_purchases WHERE org_id=$1 AND purchase_ref=$2 FOR UPDATE",[orgId,purchaseRef])).rows[0];
   if(!row||teamPurchaseView(row).terminal)return;
   await s.query("UPDATE billing_team_purchases SET closed_at=clock_timestamp() WHERE org_id=$1 AND purchase_ref=$2",[orgId,purchaseRef]);
   if(writable&&p.quote.purpose!=="credit_topup")await closePendingCommercialIntent(s,orgId,purchaseRef);
  });
 }
}
