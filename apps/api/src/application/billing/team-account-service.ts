import {TeamBillingError} from "./team-billing-error";
import {TeamCheckoutService} from "./team-checkout-service";
import type {TeamCheckoutRepository} from "./team-checkout-ports";
import type {Principal} from "../../domain/principal";
import {TeamBillingErrorCode,type TeamCatalog,type TeamEntitlement,type TeamQuote} from "@repo/contracts/billing-team";
interface AccountReader{catalog(p:Principal,org:string):Promise<TeamCatalog>;entitlement(p:Principal,org:string):Promise<TeamEntitlement>}
interface Quotes{create(p:Principal,org:string,input:unknown):Promise<TeamQuote>}
interface Reconciler{reconcile(org:string,ref:string):Promise<void>}
export class TeamAccountService{
 constructor(private readonly reader:AccountReader,private readonly quotes:Quotes,private readonly purchases:TeamCheckoutRepository,private readonly checkoutService:TeamCheckoutService,private readonly reconciler:Reconciler){}
 catalog(p:Principal,org:string){return this.call(()=>this.reader.catalog(p,org));}
 entitlement(p:Principal,org:string){return this.call(()=>this.reader.entitlement(p,org));}
 quote(p:Principal,org:string,input:unknown){return this.call(()=>this.quotes.create(p,org,input));}
 checkout(p:Principal,org:string,input:unknown){return this.call(()=>this.checkoutService.checkout(p,org,input));}
 async purchase(p:Principal,org:string,ref:string){
  return this.call(async()=>{await this.purchases.authorize(p,org);
  await this.reconciler.reconcile(org,ref);
  return this.purchases.result(org,ref);});
 }
 private async call<T>(fn:()=>Promise<T>):Promise<T>{try{return await fn();}catch(e){if(e instanceof TeamBillingError)throw e;const parsed=TeamBillingErrorCode.safeParse(e instanceof Error?e.message:undefined);throw new TeamBillingError(parsed.success?parsed.data:"dependency_unavailable",{cause:e});}}
}
