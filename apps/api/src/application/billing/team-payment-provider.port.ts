import type {TeamQuote} from "@repo/contracts/billing-team";
/** Already persisted by the shared buying core. A provider never selects price or grants rights. */
export type TeamPaymentSnapshot=Readonly<{purchaseRef:string;quote:TeamQuote;createdAt:Date;customerRef?:string}>;
export type TeamCheckoutBinding=Readonly<{sessionRef:string;url:string;expiresAt:Date}>;
export interface TeamPaymentProvider {
 readonly provider:"wechat"|"stripe";
 enabled():boolean;
 createCheckout(purchase:TeamPaymentSnapshot):Promise<TeamCheckoutBinding>;
}
