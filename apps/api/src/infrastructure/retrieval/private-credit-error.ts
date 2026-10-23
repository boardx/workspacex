import {CreditConsumptionError} from '../../application/billing/credit-consumption';
/** Private authenticated service response; never forward free-form provider error messages. */
export function throwPrivateCreditError(body:unknown,orgId:string):void {
 if(!body||typeof body!=='object'||Array.isArray(body))return;
 const value=body as Record<string,unknown>;
 if(value.code==='credit_accounting_unavailable')throw new CreditConsumptionError('credit_accounting_unavailable','team',orgId);
 if(value.code==='credit_required'&&(value.ownerType==='user'||value.ownerType==='team')&&typeof value.ownerId==='string'){
  if(value.ownerType==='team'&&value.ownerId!==orgId)throw new CreditConsumptionError('credit_accounting_unavailable','team',orgId);
  throw new CreditConsumptionError('credit_required',value.ownerType,value.ownerId);
 }
}
