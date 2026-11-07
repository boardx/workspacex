import {z} from "zod";
import {EnterpriseCreditGrantRequest,EnterpriseUpgradeRequest} from "@repo/contracts/billing-team";
export const EnterprisePendingRequest=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("grant"),input:EnterpriseCreditGrantRequest}).strict(),
 z.object({kind:z.literal("upgrade"),input:EnterpriseUpgradeRequest}).strict(),
]);
export type EnterprisePendingRequest=z.infer<typeof EnterprisePendingRequest>;
export function readEnterprisePending(key:string):EnterprisePendingRequest|null{
 const raw=sessionStorage.getItem(key);return raw===null?null:EnterprisePendingRequest.parse(JSON.parse(raw));
}
export function saveEnterprisePending(key:string,request:EnterprisePendingRequest):void{
 sessionStorage.setItem(key,JSON.stringify(EnterprisePendingRequest.parse(request)));
}
export function clearEnterprisePending(key:string,idempotencyKey:string):void{
 if(readEnterprisePending(key)?.input.idempotencyKey===idempotencyKey)sessionStorage.removeItem(key);
}
