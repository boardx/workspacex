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
it('preserves validated private payer and monthly reason without trusting a recharge URL',()=>{
 expect(()=>throwPrivateCreditFailure({error:'CreditRuntimeUsageError',message:'credit_required',ownerType:'user',ownerId:'owned-user',rechargePath:'https://evil.invalid'})).toThrow(expect.objectContaining({code:'CREDIT_REQUIRED',creditPayer:{ownerType:'user',ownerId:'owned-user'}}));
 expect(()=>throwPrivateCreditFailure({error:'CreditRuntimeUsageError',message:'credit_required',ownerType:'other',ownerId:'forged',reason:'member_monthly_limit'})).toThrow(expect.objectContaining({creditPayer:undefined,creditReason:'member_monthly_limit'}));
});
it.each([['credit_required','CREDIT_REQUIRED'],['credit_accounting_unavailable','CREDIT_ACCOUNTING_UNAVAILABLE']])('SSE terminal error %s retains typed refusal without a second request',async(message,code)=>{
 const fetch=vi.fn(async()=>new Response(`event: error\ndata: ${JSON.stringify({error:'CreditRuntimeUsageError',message,ownerType:'user',ownerId:'owned-user'})}\n\nevent: metadata\ndata: {"status":"error"}\n\n`,{headers:{'content-type':'text/event-stream'}}));vi.stubGlobal('fetch',fetch);
 const provider=new DeepAgentModelProvider({} as never) as unknown as {tryStreamRun(...args:unknown[]):Promise<boolean>};
 await expect(provider.tryStreamRun('http://private.test','thread','run',async()=>{},async()=>{},new Set(),Date.now()+1000)).rejects.toMatchObject({code});
 expect(fetch).toHaveBeenCalledTimes(1);
});
