import {ModelCallError} from '../../application/agent-run/ports';
/** Only a dedicated private runtime exception class plus a stable code is authoritative.
 * Never infer a billing refusal from arbitrary provider text or a user's message. */
export function throwPrivateCreditFailure(value:unknown):void {
 if(!value||typeof value!=='object'||Array.isArray(value))return;
 const envelope=value as Record<string,unknown>;
 const error=typeof envelope.error==='object'&&envelope.error!==null&&!Array.isArray(envelope.error)?envelope.error as Record<string,unknown>:envelope;
 if(error.error!=='CreditRuntimeUsageError')return;
 if(error.message==='credit_required')throw new ModelCallError('CREDIT_REQUIRED','private_credit_required');
 if(error.message==='credit_accounting_unavailable')throw new ModelCallError('CREDIT_ACCOUNTING_UNAVAILABLE','private_credit_accounting_unavailable');
}
