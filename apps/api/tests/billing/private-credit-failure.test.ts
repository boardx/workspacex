import {it,expect,vi,afterEach} from 'vitest';
import {throwPrivateCreditFailure} from '../../src/infrastructure/agent-run/private-credit-failure';
import {DeepAgentModelProvider} from '../../src/infrastructure/agent-run/deep-agent-model-provider';
afterEach(()=>vi.unstubAllGlobals());
it.each([['credit_required','CREDIT_REQUIRED'],['credit_accounting_unavailable','CREDIT_ACCOUNTING_UNAVAILABLE']])('preserves the structured private class/code %s',async(message,code)=>{
 expect(()=>throwPrivateCreditFailure({error:'CreditRuntimeUsageError',message})).toThrow(expect.objectContaining({code}));
 const fetch=vi.fn(async()=>Response.json({status:'error',error:{error:'CreditRuntimeUsageError',message}}));vi.stubGlobal('fetch',fetch);
 const provider=new DeepAgentModelProvider({} as never) as unknown as {readRunStatus(base:string,thread:string,run:string):Promise<string>};
 await expect(provider.readRunStatus('http://private.test','thread','run')).rejects.toMatchObject({code});expect(fetch).toHaveBeenCalledTimes(1);
});
it('does not reinterpret provider text, another error class or nested user content as a billing refusal',()=>{
 for(const body of [{message:'credit_required'},{error:'ValueError',message:'credit_required'},{error:'CreditRuntimeUsageError',message:'credit_required: private details'},{content:{error:'CreditRuntimeUsageError',message:'credit_required'}}])expect(()=>throwPrivateCreditFailure(body)).not.toThrow();
});
