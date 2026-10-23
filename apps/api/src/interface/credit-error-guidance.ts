import {CreditConsumptionError} from "../application/billing/credit-consumption";
import {CreditRequiredBody} from "@repo/contracts/billing-consumption";
/** Typed local billing decisions only; provider text cannot request a financial action. */
export function creditErrorGuidance(error:unknown){
 if(!(error instanceof CreditConsumptionError))return null;
 const credit=error.code==='credit_required'?CreditRequiredBody.safeParse({code:error.code,ownerType:error.ownerType,ownerId:error.ownerId,rechargePath:error.rechargePath}):null;
 return credit?.success?{reason:'CREDIT_REQUIRED' as const,credit:credit.data}:{reason:'CREDIT_ACCOUNTING_UNAVAILABLE' as const};
}
