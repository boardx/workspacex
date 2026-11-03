import type {Principal} from "../../domain/principal";
import type {TeamCheckoutRequest,TeamPurchaseOutcome} from "@repo/contracts/billing-team";
import type {TeamPaymentSnapshot,TeamCheckoutBinding} from "./team-payment-provider.port";
export type StoredTeamPurchase=TeamPaymentSnapshot & {terminal:boolean;binding:TeamCheckoutBinding|null};
/** All methods scope by actual target organization; reserve rechecks capacity/version in its transaction. */
export interface TeamCheckoutRepository{
 authorize(principal:Principal,orgId:string):Promise<void>;
 find(orgId:string,key:string):Promise<StoredTeamPurchase|null>;
 reserve(principal:Principal,orgId:string,request:TeamCheckoutRequest):Promise<StoredTeamPurchase>;
 bind(orgId:string,purchaseRef:string,binding:TeamCheckoutBinding):Promise<StoredTeamPurchase>;
 result(orgId:string,purchaseRef:string):Promise<TeamPurchaseOutcome>;
}
