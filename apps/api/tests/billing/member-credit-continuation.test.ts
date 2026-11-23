import {it,expect,vi} from 'vitest';
import {RealtimeVoiceAccounting} from '../../src/application/chat/realtime-voice-accounting';
import {CreditConsumptionError} from '../../src/application/billing/credit-consumption';
import {DurableCreditUsageMeter} from '../../src/infrastructure/billing/durable-credit-usage';
import {throwPrivateCreditError} from '../../src/infrastructure/retrieval/private-credit-error';
import {throwPrivateCreditFailure} from '../../src/infrastructure/agent-run/private-credit-failure';
import {PgAuxiliaryModelAccounting} from '../../src/infrastructure/billing/pg-auxiliary-model-accounting';
import type {Principal} from '../../src/domain/principal';
import type {DatabasePort} from '../../src/application/ports/database.port';
const principal={userId:'user',orgId:'org'} as Principal;
it.each(['member_monthly_limit',undefined] as const)('finalizes committed usage after a typed continuation stop: %s',async reason=>{
 const record=vi.fn().mockResolvedValue(undefined),check=vi.fn().mockRejectedValue(new CreditConsumptionError('credit_required',reason?'team':'user',reason?'org':'user',undefined,reason));
 const billing=new RealtimeVoiceAccounting({startRequest:vi.fn().mockResolvedValue(undefined),record,assertCreditContinuation:check},principal,'voice');
 await billing.start(null);billing.markDispatched();
 await expect(billing.receive({type:'response.done',response:{id:'response',status:'completed',usage:{total_tokens:1000,input_tokens:500,output_tokens:500}}})).rejects.toMatchObject({code:'credit_required',reason});
 expect(record.mock.invocationCallOrder[0]).toBeLessThan(check.mock.invocationCallOrder[0]!);
 await billing.finish(true);
 expect(record).toHaveBeenLastCalledWith('org',expect.objectContaining({tokensTotal:1000,totalSource:'reported',billingReceipt:{id:'session-final',final:true}}));
});
it('durable meter forwards continuation checks outside receipt/replay handling',async()=>{
 const check=vi.fn().mockRejectedValue(new CreditConsumptionError('credit_required','team','org',undefined,'member_monthly_limit'));
 const meter=new DurableCreditUsageMeter({record:vi.fn(),assertCreditContinuation:check});
 await expect(meter.assertCreditContinuation(principal.orgId,'user','request')).rejects.toMatchObject({reason:'member_monthly_limit'});
 expect(check).toHaveBeenCalledWith('org','user','request');
});
it('preserves only allowlisted monthly-limit reasons across authenticated private billing errors',()=>{
 const body={code:'credit_required',ownerType:'team',ownerId:'org',reason:'member_monthly_limit'};
 expect(()=>throwPrivateCreditError(body,'org')).toThrow(expect.objectContaining({reason:'member_monthly_limit'}));
 expect(()=>throwPrivateCreditError({...body,reason:'provider-custom'},'org')).toThrow(expect.objectContaining({reason:undefined}));
 expect(()=>throwPrivateCreditError({...body,ownerId:'other-org'},'org')).toThrow(expect.objectContaining({code:'credit_accounting_unavailable'}));
 expect(()=>throwPrivateCreditFailure({error:'CreditRuntimeUsageError',message:'credit_required',reason:'member_monthly_limit'})).toThrow(expect.objectContaining({creditReason:'member_monthly_limit'}));
});
it('auxiliary reconstruction preserves validated reason with canonical payer',async()=>{
 const query=vi.fn(async()=>({rows:[{user_id:'user'}]}));
 const db={withTenant:async(_org:unknown,work:(s:unknown)=>unknown)=>work({query})} as unknown as DatabasePort;
 const billing=new PgAuxiliaryModelAccounting(db);
 expect(await billing.failure(principal.orgId,'operation','credit_required','member_monthly_limit')).toMatchObject({ownerType:'team',ownerId:'org',reason:'member_monthly_limit'});
 expect(await billing.failure(principal.orgId,'operation','credit_required','provider-custom')).toMatchObject({reason:undefined});
});

it.each([null,new CreditConsumptionError('credit_required','team','org',undefined,'member_monthly_limit')])('a rejected interim write retains trusted provider usage for the terminal receipt: %s',async failure=>{
 const record=vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined),check=vi.fn();
 const billing=new RealtimeVoiceAccounting({startRequest:vi.fn().mockResolvedValue(undefined),record,assertCreditContinuation:check},principal,'voice');
 await billing.start(null);billing.markDispatched();
 await expect(billing.receive({type:'response.done',response:{id:'response',status:'completed',usage:{total_tokens:1000,input_tokens:500,output_tokens:500}}})).rejects.toBe(failure);
 expect(check).not.toHaveBeenCalled();await billing.finish(true);
 expect(record).toHaveBeenLastCalledWith('org',expect.objectContaining({totalSource:'reported',outcome:'succeeded',tokensTotal:1000,billingReceipt:{id:'session-final',final:true}}));
});

it("preserves successful turns on disconnect and excludes a cancelled turn's reported tokens",async()=>{
 const record=vi.fn().mockResolvedValue(undefined);
 const billing=new RealtimeVoiceAccounting({startRequest:vi.fn().mockResolvedValue(undefined),record},principal,"voice");
 await billing.start(null);billing.markDispatched();
 for(const [id,status,total] of [["ok","completed",11],["cancel","cancelled",500]] as const){
  await billing.receive({type:"response.done",response:{id,status,usage:{total_tokens:total,input_tokens:total,output_tokens:0}}});
 }
 await billing.receive({type:"response.created",response:{id:"unfinished"}});
 await billing.finish(true);
 expect(record).toHaveBeenLastCalledWith("org",expect.objectContaining({outcome:"succeeded",tokensTotal:11,totalSource:"reported",billingReceipt:{id:"session-final",final:true}}));
});
