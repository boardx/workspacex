import type {TeamQuote} from "@repo/contracts/billing-team";
/** Already persisted by the shared buying core. A provider never selects price or grants rights. */
/** checkoutExpiresAt is a persisted payment deadline, independent of quote expiry. */
export type TeamPaymentSnapshot=Readonly<{purchaseRef:string;quote:TeamQuote;createdAt:Date;checkoutExpiresAt:Date;customerRef?:string}>;
export type TeamCheckoutBinding=Readonly<{sessionRef:string;url:string;expiresAt:Date}>;
export interface TeamPaymentProvider {
 readonly provider:"wechat"|"stripe";
 enabled():boolean;
 createCheckout(purchase:TeamPaymentSnapshot):Promise<TeamCheckoutBinding>;
}
