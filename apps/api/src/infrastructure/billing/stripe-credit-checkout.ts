import {requireLegacyOrderEpoch} from "./legacy-billing-epoch";
import {CREDIT_TOPUP_PRODUCT} from "@repo/contracts/billing-credits";
import {PricingCurrency} from "@repo/contracts/billing-pricing";
import type {DatabasePort,TenantSession} from "../../application/ports/database.port";
import type {BillingOwner} from "../../application/billing/billing-wallet-service";
import {BillingOrderError,type OrderDraft,type OrderView,type StripeCreditCheckoutPort} from "../../application/billing/billing-order-service";
import {PgBillingOrderRepository} from "./pg-billing-order-repository";
import type {DeploymentBillingConfig} from "./deployment-billing-config";
import {StripeCreditClient} from "./stripe-credit-client";
import {BILLING_GLOBAL_SQL as K,assertBillingGlobalStatement} from "./billing-global-boundary";
import {STRIPE_CREDIT_SQL} from "./stripe-credit-sql";
export {STRIPE_CREDIT_SQL} from "./stripe-credit-sql";
type Row={order_no:string;owner_type:OrderView['ownerType'];owner_id:string;created_by:string;package_id:string;amount_fen:number;base_credits:number;bonus_credits:number;currency:string;provider:string;status:string;channel_order_no:string|null;stripe_session_ref:string|null;last_error_code:string|null;created_at:Date;expired_at:Date};
export class StripeCreditCheckout implements StripeCreditCheckoutPort{
 private readonly client:StripeCreditClient;
 private readonly repository:PgBillingOrderRepository;
 constructor(private readonly db:DatabasePort,config:DeploymentBillingConfig){this.client=new StripeCreditClient(config);this.repository=new PgBillingOrderRepository(db);}
 private draft(r:Row):OrderDraft{return {orderNo:r.order_no,ownerType:r.owner_type,ownerId:r.owner_id,createdBy:r.created_by,packageId:r.package_id,amountFen:r.amount_fen,baseCredits:r.base_credits,bonusCredits:r.bonus_credits,currency:r.currency,provider:'stripe',status:'PENDING',createdAt:r.created_at.toISOString(),expiredAt:r.expired_at.toISOString(),paidAt:null,notifyAt:null,closedAt:null,lastErrorCode:null};}
 private async view(owner:BillingOwner,id:string){const order=await this.repository.order(owner,id);if(!order)throw new BillingOrderError('order_not_found');return order;}
 async create(owner:BillingOwner,draft:OrderDraft):Promise<OrderView>{
  if(!this.client.enabled())throw new BillingOrderError("payment_provider_not_configured");
  const row=await this.db.withTenant(owner.orgId,async s=>{
   await requireLegacyOrderEpoch(s);
   await s.query(STRIPE_CREDIT_SQL.ownerLock,[`stripe-credit:${owner.ownerType}:${owner.ownerId}`]);
   const existing=(await s.query<Row>(STRIPE_CREDIT_SQL.pending,[owner.ownerType,owner.ownerId])).rows[0];
   if(existing){if(existing.package_id!==draft.packageId)throw new BillingOrderError('order_not_pending');return existing;}
   return (await s.query<Row>(STRIPE_CREDIT_SQL.reserve,[draft.orderNo,owner.ownerType,owner.ownerId,draft.createdBy,draft.packageId,draft.amountFen,draft.baseCredits,draft.bonusCredits,draft.currency,draft.createdAt,new Date(Date.parse(draft.createdAt)+86400000).toISOString()])).rows[0]!;
  });
  await this.ensureSession(owner,row);
  return this.reconcile(owner,await this.view(owner,row.order_no));
 }
 private async ensureSession(owner:BillingOwner,row:Row):Promise<string>{
  if(row.stripe_session_ref)return row.stripe_session_ref;
  if(Date.now()-row.created_at.getTime()>23*3600000)throw new BillingOrderError('order_not_pending');
  await this.repository.assertLegacySales(owner.orgId);
  const session=await this.client.create(this.draft(row));
  await this.db.withTenant(owner.orgId,s=>s.query(STRIPE_CREDIT_SQL.bind,[row.order_no,session.id,session.url??'pending']));
  return session.id as string;
 }
 async reconcile(owner:BillingOwner,order:OrderView):Promise<OrderView>{
  const row=await this.db.withTenant(owner.orgId,async s=>(await s.query<Row>(K.lockOrder,[order.orderNo])).rows[0]);
  if(!row||row.provider!=='stripe'||row.owner_type!==owner.ownerType||row.owner_id!==owner.ownerId)throw new BillingOrderError('order_not_found');
  const sessionRef=row.stripe_session_ref??(row.status==='PENDING'?await this.ensureSession(owner,row):null);
  if(sessionRef)await this.accept(sessionRef);
  return this.view(owner,order.orderNo);
 }
 async accept(sessionRef:string){
  const session=await this.client.retrieve(sessionRef);
  return this.db.withoutTenant(async raw=>{
   const s:TenantSession={query(sql,params){assertBillingGlobalStatement(sql);return raw.query(sql,params);}};
   await requireLegacyOrderEpoch(s);
   const metadata=session.metadata as Record<string,unknown>|null;
   const orderRef=metadata?.order_ref;
   if(typeof orderRef!=="string"||!/^bg[0-9]{14}[A-Za-z0-9]{6}$/.test(orderRef))return false;
   const row=(await s.query<Row>(K.lockOrder,[orderRef])).rows[0];if(!row||row.provider!=="stripe")return false;
   if(row.stripe_session_ref!==null&&row.stripe_session_ref!==sessionRef)throw Error("stripe_credit_session_conflict");
   const meta=session.metadata as Record<string,unknown>|null;
   if(!PricingCurrency.safeParse(row.currency).success||session.mode!=='payment'||session.client_reference_id!==row.order_no||session.amount_total!==row.amount_fen||session.currency!==row.currency.toLowerCase()||meta?.product!==CREDIT_TOPUP_PRODUCT||meta.order_ref!==row.order_no)throw Error('stripe_credit_snapshot_mismatch');
   if(!row.stripe_session_ref)await s.query(STRIPE_CREDIT_SQL.bind,[row.order_no,sessionRef,session.url??'pending']);
   if(session.status==='expired'&&session.payment_status!=='paid')await s.query(STRIPE_CREDIT_SQL.close,[row.order_no]);
   if(session.payment_status!=='paid'||session.status!=='complete')return true;
   if(typeof session.payment_intent!=='string'||!/^pi_[A-Za-z0-9_]+$/.test(session.payment_intent))throw Error('stripe_credit_payment_invalid');
   if((await s.query(STRIPE_CREDIT_SQL.paymentOwner,[session.payment_intent,row.order_no])).rows.length)throw Error('stripe_credit_payment_conflict');
   if(row.channel_order_no!==null&&row.channel_order_no!==session.payment_intent)throw Error('stripe_credit_payment_conflict');
   if(row.status==='SUCCESS')return true;
   // A paid capacity failure belongs to manual recovery, even if capacity later changes.
   if(['FAILED','CLOSED'].includes(row.status)&&row.last_error_code==='invalid_amount')return true;
   if(!['PENDING','CLOSED','PROCESSING'].includes(row.status))throw Error('stripe_credit_state_invalid');
   await this.credit(s,row,session.payment_intent);return true;
  });
 }
 private async credit(s:TenantSession,row:Row,payment:string){
  if(row.status==="PENDING")await s.query(K.claimOrder,[row.order_no,payment]);
  if(row.status==="CLOSED")await s.query(K.bindClosedOrder,[row.order_no,payment]);
  await s.query(K.ensureWallet,[row.owner_type,row.owner_id]);
  const w=(await s.query<{wallet_id:string;balance:string;total_purchased:string}>(K.lockWallet,[row.owner_type,row.owner_id])).rows[0]!;
  const balance=Number(w.balance),total=row.base_credits+row.bonus_credits;
  if(balance+total>2147483647||Number(w.total_purchased)+row.base_credits>2147483647){
   await s.query(row.status==='CLOSED'?K.markClosedCapacity:K.failCapacity,[row.order_no]);
   return;
  }
  await s.query(K.purchaseLedger,[w.wallet_id,row.base_credits,balance+row.base_credits,row.order_no]);
  if(row.bonus_credits)await s.query(K.bonusLedger,[w.wallet_id,row.bonus_credits,balance+total,row.order_no]);
  await s.query(K.updateWallet,[w.wallet_id,total,row.base_credits]);
  await s.query(K.succeedOrder,[row.order_no,payment,new Date()]);
 }
 async cancel(owner:BillingOwner,order:OrderView){
  const row=await this.db.withTenant(owner.orgId,async s=>(await s.query<Row>(K.lockOrder,[order.orderNo])).rows[0]);
  if(!row||row.owner_id!==owner.ownerId||row.owner_type!==owner.ownerType||row.provider!=='stripe')throw new BillingOrderError('order_not_found');
  if(!row.stripe_session_ref)throw new BillingOrderError('order_not_cancelable');
  try{await this.client.expire(row.stripe_session_ref);}catch{const current=await this.reconcile(owner,order);if(current.status==='SUCCESS')return current;throw new BillingOrderError('order_not_cancelable');}
  const session=await this.client.retrieve(row.stripe_session_ref);await this.accept(row.stripe_session_ref);
  if(session.status==='expired'&&session.payment_status!=='paid')await this.db.withTenant(owner.orgId,s=>s.query(STRIPE_CREDIT_SQL.close,[order.orderNo]));
  return this.view(owner,order.orderNo);
 }
}
