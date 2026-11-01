import { z } from "zod";
import { PersonalCheckoutRequest, PersonalCheckoutResult } from "@repo/contracts/billing-pricing";
import { requirePaymentUrl } from "./payment-url";
export type CheckoutStorage=Pick<Storage,"getItem"|"setItem"|"removeItem">;
const Pending=z.object({userId:z.string().min(1),request:PersonalCheckoutRequest,result:PersonalCheckoutResult.nullable()}).strict();
export type PendingPersonalCheckout=z.infer<typeof Pending>;
const storageKey=(userId:string)=>`workspacex:personal-checkout:v1:${encodeURIComponent(userId)}`;
/** Local state is only a recovery pointer, never payment or credit proof. Corruption cannot silently start a second purchase. */
export function loadPersonalCheckout(storage:CheckoutStorage,userId:string):PendingPersonalCheckout|null {
 try {
  const raw=storage.getItem(storageKey(userId));if(raw===null)return null;
  const pending=Pending.parse(JSON.parse(raw));
  if(pending.userId!==userId||pending.result&&pending.result.provider!==pending.request.provider)throw Error("scope_mismatch");
  if(pending.result)requirePaymentUrl(pending.result.url,pending.result.provider);
  return pending;
 }catch{throw Error("pending_purchase_unreadable");}
}
export function beginPersonalCheckout(storage:CheckoutStorage,userId:string,input:z.input<typeof PersonalCheckoutRequest>):PendingPersonalCheckout {
 const request=PersonalCheckoutRequest.parse(input),existing=loadPersonalCheckout(storage,userId);
 if(existing){
  if(["sku","catalogVersion","provider"].some(key=>existing.request[key as keyof typeof request]!==request[key as keyof typeof request]))throw Error("pending_purchase_exists");
  return existing;
 }
 const pending=Pending.parse({userId,request,result:null});storage.setItem(storageKey(userId),JSON.stringify(pending));return pending;
}
export function bindPersonalCheckout(storage:CheckoutStorage,userId:string,key:string,input:unknown):PendingPersonalCheckout {
 const existing=loadPersonalCheckout(storage,userId);if(!existing)throw Error("pending_purchase_missing");
 const result=PersonalCheckoutResult.parse(input);
 if(existing.request.idempotencyKey!==key||existing.request.provider!==result.provider)throw Error("pending_purchase_conflict");
 requirePaymentUrl(result.url,result.provider);
 if(existing.result&&Object.keys(result).some(field=>existing.result![field as keyof typeof result]!==result[field as keyof typeof result]))throw Error("pending_purchase_conflict");
 const pending={...existing,result};storage.setItem(storageKey(userId),JSON.stringify(pending));return pending;
}
export function clearPersonalCheckout(storage:CheckoutStorage,userId:string,key:string):void {
 const existing=loadPersonalCheckout(storage,userId);if(existing?.request.idempotencyKey===key)storage.removeItem(storageKey(userId));
}
