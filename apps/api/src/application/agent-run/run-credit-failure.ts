import {CreditRequiredBody} from '@repo/contracts/billing-consumption';
import {CreditConsumptionError} from '../billing/credit-consumption';
import {ModelCallError,type RunProjection} from './ports';
export function ownedRunCreditFailure(error:unknown,userId:string|null|undefined,orgId:string):{code:'CREDIT_REQUIRED'|'CREDIT_ACCOUNTING_UNAVAILABLE';creditFailure?:RunProjection['creditFailure']}|null{
 const direct=error instanceof CreditConsumptionError;
 if(!direct&&!(error instanceof ModelCallError))return null;
 const code=direct?error.code:(error as ModelCallError).code;
 if(code==='credit_accounting_unavailable'||code==='CREDIT_ACCOUNTING_UNAVAILABLE')return {code:'CREDIT_ACCOUNTING_UNAVAILABLE'};
 if(code!=='credit_required'&&code!=='CREDIT_REQUIRED')return null;
 const payer=direct?{ownerType:error.ownerType,ownerId:error.ownerId}:(error as ModelCallError).creditPayer;
 if(!payer||!userId)return {code:'CREDIT_REQUIRED'};
 if(!((payer.ownerType==='user'&&payer.ownerId===userId)||(payer.ownerType==='team'&&payer.ownerId===orgId)))return {code:'CREDIT_ACCOUNTING_UNAVAILABLE'};
 const trusted=new CreditConsumptionError('credit_required',payer.ownerType,payer.ownerType==='user'?userId:orgId,undefined,direct?error.reason:(error as ModelCallError).creditReason);
 return {code:'CREDIT_REQUIRED',creditFailure:CreditRequiredBody.parse({code:trusted.code,ownerType:trusted.ownerType,ownerId:trusted.ownerId,rechargePath:trusted.rechargePath,...(trusted.reason?{reason:trusted.reason}:{})})};
}
type CreditFailureView = Pick<RunProjection, "status" | "creditFailure"> & { error: string | null };
export function creditFailureForViewer(view:RunProjection,userId:string):RunProjection;
export function creditFailureForViewer(view:CreditFailureView,userId:string):CreditFailureView;
export function creditFailureForViewer(view:CreditFailureView,userId:string):CreditFailureView{
 if(view.status!=='failed'||view.error!=='CREDIT_REQUIRED'||view.creditFailure?.ownerType==='user'&&view.creditFailure.ownerId!==userId){const {creditFailure,...rest}=view;return rest;}
 return view;
}
