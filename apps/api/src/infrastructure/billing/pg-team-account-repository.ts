import {TeamCatalog,TeamEntitlement,TeamPaidTerm} from "@repo/contracts/billing-team";
import type {DatabasePort} from "../../application/ports/database.port";
import type {Principal} from "../../domain/principal";
import {BILLING_ACCOUNTING_GENERATION as generation} from "../../domain/billing/billing-generation";
import {TeamBillingAccess} from "../../application/billing/team-billing-access";
import {readProductConfiguration} from "./product-catalog-configuration";
import {teamConfiguredProducts} from "./team-product-configuration";
import {lockOrganizationCapacity} from "../org-capacity/pg-commercial-capacity";
import {requireActivePricingEpoch} from "./personal-pricing-epoch";
import {grantDueTeamTerms} from "./team-credit-terms";
import {PgBillingWalletRepository} from "./pg-billing-wallet-repository";
export class PgTeamAccountRepository{
 constructor(private readonly db:DatabasePort,private readonly access:TeamBillingAccess,private readonly salesEnabled:()=>boolean=()=>false,private readonly market:()=>TeamCatalog["market"]|null=()=>null){}
 async catalog(principal:Principal,target:string){
  const orgId=await this.access.authorize(principal,target),market=this.market();
  if(!market)throw Error("dependency_unavailable");
  return this.db.withTenant(orgId,async s=>{
   await requireActivePricingEpoch(s);const configured=await readProductConfiguration(s,market);
   return TeamCatalog.parse({orgId,version:configured.version,market,enabledProviders:this.salesEnabled()&&market==="cn"?["wechat"]:[],products:teamConfiguredProducts(configured.rows)});
  });
 }
 async entitlement(principal:Principal,target:string){
  const orgId=await this.access.authorize(principal,target);
  // All mutations use the same epoch/org lock. This read's wallet adapter shares the transaction.
  return this.db.withTenant(orgId,async s=>{
   await lockOrganizationCapacity(s,orgId);await requireActivePricingEpoch(s);const now=new Date();
   await grantDueTeamTerms(s,orgId,now);
   const plan=(await s.query<{plan:string;version:number;billing_generation:string|null}>("SELECT plan,version,billing_generation FROM organization_plans WHERE org_id=$1",[orgId])).rows[0];
   const currentEnterprise=plan?.plan==="enterprise"&&plan.billing_generation===generation;
   if(plan?.billing_generation&&plan.billing_generation!==generation||plan?.plan==="enterprise"&&!currentEnterprise)throw Error("dependency_unavailable");
   const license=(await s.query<{purchased_seats:string|null;pending_purchase_ref:string|null}>("SELECT purchased_seats::text,pending_purchase_ref FROM org_commercial_licenses WHERE org_id=$1 AND generation=$2",[orgId,generation])).rows[0];
   const count=(await s.query<{n:string}>("SELECT count(*)::text AS n FROM org_memberships WHERE org_id=$1",[orgId])).rows[0];
   if(!count)throw Error("dependency_unavailable");
   const row=(await s.query<{purchase_ref:string;paid_term:unknown}>("SELECT purchase_ref,paid_term FROM billing_team_terms WHERE org_id=$1 AND generation=$2 ORDER BY (paid_term->>'paidPeriodEnd')::timestamptz DESC LIMIT 1",[orgId,generation])).rows[0];
   const term=row?TeamPaidTerm.parse(row.paid_term):null;
   if(license?.purchased_seats&&!term)throw Error("dependency_unavailable");
   const payment=term?{term,provider:"wechat",renewalMode:"manual",cancelAtPeriodEnd:false,subscriptionStatus:null}:null;
   const period=row?(await s.query<{granted_hundredths:string;remaining_hundredths:string;period_start:Date;period_end:Date}>("SELECT p.granted_hundredths::text,p.remaining_hundredths::text,p.period_start,p.period_end FROM credit_subscription_periods p JOIN credit_wallets w USING(wallet_id) WHERE w.owner_type='team' AND w.owner_id=$1 AND p.subscription_ref=$2 ORDER BY p.period_start DESC,p.period_id DESC LIMIT 1",[orgId,row.purchase_ref])).rows[0]:undefined;
   const creditGrant=period?{status:period.period_end<=now?"expired":"granted",grant:{credits:Number(period.granted_hundredths)/100,remainingCredits:Number(period.remaining_hundredths)/100,periodStart:period.period_start.toISOString(),periodEnd:period.period_end.toISOString()}}:{status:term&&Date.parse(term.paidPeriodEnd)>now.getTime()?"pending":"none",grant:null};
   const transactionalDb:DatabasePort={withTenant:async(_org,fn)=>fn(s),withoutTenant:async()=>{throw Error("global access unavailable");},close:async()=>{}};
   const {wallet}=await new PgBillingWalletRepository(transactionalDb).wallet({ownerType:"team",ownerId:orgId,orgId});
   const review=(await s.query("SELECT 1 FROM billing_team_purchases WHERE org_id=$1 AND generation=$2 AND payment_review_required LIMIT 1",[orgId,generation])).rows.length>0;
   return TeamEntitlement.parse({orgId,generation,planVersion:plan?.version??0,asOf:now.toISOString(),licenseStatus:currentEnterprise?"enterprise":term?Date.parse(term.paidPeriodEnd)<=now.getTime()?"expired":"active":"none",memberCount:Number(count.n),teamPayment:payment,creditGrant,wallet,checkoutPending:!!license?.pending_purchase_ref,paymentReviewRequired:review});
  });
 }
}
