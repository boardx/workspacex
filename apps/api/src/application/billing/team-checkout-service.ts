import {TeamCheckoutRequest} from "@repo/contracts/billing-team";
import {assertPrincipal,type Principal} from "../../domain/principal";
import type {TeamCheckoutRepository} from "./team-checkout-ports";
import type {TeamPaymentProvider} from "./team-payment-provider.port";
/** Upstream request always follows committed intent; existing results remain recoverable under closed sales. */
export class TeamCheckoutService{
 constructor(private readonly repository:TeamCheckoutRepository,private readonly provider:TeamPaymentProvider){}
 async checkout(principal:Principal,orgId:string,input:unknown){
  assertPrincipal(principal);
  const request=TeamCheckoutRequest.parse(input);
  await this.repository.authorize(principal,orgId);
  const original=await this.repository.find(orgId,request.idempotencyKey);
  if(original&&original.quote.quoteRef!==request.quoteRef)throw Error("idempotency_conflict");
  // Only new intents apply the sale gate; existing owned outcomes must stay recoverable.
  if(!original&&!this.provider.enabled())throw Error("payment_provider_not_configured");
  const purchase=original??await this.repository.reserve(principal,orgId,request);
  if(purchase.terminal||purchase.binding)return this.repository.result(orgId,purchase.purchaseRef);
  if(purchase.quote.provider!==this.provider.provider||!this.provider.enabled())throw Error("dependency_unavailable");
  let binding;
  try{binding=await this.provider.createCheckout(purchase);}catch{throw Error("dependency_unavailable");}
  await this.repository.bind(orgId,purchase.purchaseRef,binding);
  return this.repository.result(orgId,purchase.purchaseRef);
 }
}
