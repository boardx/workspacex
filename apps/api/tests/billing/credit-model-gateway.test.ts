import {describe,it,expect,vi} from 'vitest';
import {creditModelGateway} from '../../src/infrastructure/billing/credit-model-gateway';
import {CreditConsumptionError} from '../../src/application/billing/credit-consumption';
import {withCreditSubject} from '../../src/application/billing/credit-execution-context';
import type {ModelCallInput,ModelCallPort,TokenUsageMeterPort} from '../../src/application/agent-run/ports';
import type {DatabasePort} from '../../src/application/ports/database.port';
import type {OrgId} from '../../src/domain/org-id';
const orgId='org-credit' as OrgId;
const db={withTenant:vi.fn(),withoutTenant:vi.fn(),close:vi.fn()} as DatabasePort;
const input={modelProvider:'test',modelId:'model',system:'system',user:'question'} as ModelCallInput;
function setup(){
 const dispatch=vi.fn();
 const perform=async(i:ModelCallInput)=>{
  await i.beforeProviderDispatch?.({requestId:'req',modelProvider:'test',modelId:'model',serializedBody:'{"messages":[]}',outputTokenLimit:100});
  await i.onProviderRequest?.({phase:'started',requestId:'req',startedAt:'2026-10-22T00:00:00Z'});
  dispatch();
  await i.onProviderRequest?.({phase:'terminal',requestId:'req',startedAt:'2026-10-22T00:00:00Z',endedAt:'2026-10-22T00:00:01Z',usage:{total:11,prompt:6,completion:5},outcome:'succeeded'});
  return {text:'ok',tokens:11};
 };
 const raw={supportsRequestAccounting:()=>true,complete:perform,completeStream:async(i:ModelCallInput,delta:(s:string)=>Promise<void>)=>{const result=await perform(i);await delta('ok');return result;}} as ModelCallPort;
 const meter={startRequest:vi.fn().mockResolvedValue(undefined),record:vi.fn().mockResolvedValue(undefined)} as TokenUsageMeterPort;
 return {gateway:creditModelGateway(raw,db,meter),meter,dispatch};
}
describe('mandatory credit model gateway',()=>{
 it('rejects missing trusted subject before transport',async()=>{const {gateway,dispatch}=setup();await expect(gateway.complete(input)).rejects.toThrow('CREDIT_SUBJECT_UNAVAILABLE');expect(dispatch).not.toHaveBeenCalled();});
 it('reserves before dispatch and settles the same physical request',async()=>{const {gateway,meter,dispatch}=setup();await withCreditSubject({orgId,userId:'user'},()=>gateway.complete(input));expect(meter.startRequest).toHaveBeenCalledWith(orgId,expect.objectContaining({requestId:'req',userId:'user',maximumTokens:115}));expect(dispatch).toHaveBeenCalledTimes(1);expect(meter.record).toHaveBeenCalledWith(orgId,expect.objectContaining({eventId:'req',tokensTotal:11}));});
 it('failed reservation prevents actual dispatch',async()=>{const {gateway,meter,dispatch}=setup();vi.mocked(meter.startRequest!).mockRejectedValue(new Error('insufficient_credit'));await expect(withCreditSubject({orgId,userId:'user'},()=>gateway.complete(input))).rejects.toThrow('insufficient_credit');expect(dispatch).not.toHaveBeenCalled();expect(meter.record).not.toHaveBeenCalled();});
 it('uses same boundary for streaming',async()=>{const {gateway,meter}=setup();const delta=vi.fn();await withCreditSubject({orgId,userId:'user'},()=>gateway.completeStream!(input,delta));expect(delta).toHaveBeenCalledWith('ok');expect(meter.record).toHaveBeenCalledTimes(1);});
 it('opaque research refuses before any paid transport',async()=>{const complete=vi.fn();const raw={complete,supportsRequestAccounting:()=>false} as ModelCallPort;const gateway=creditModelGateway(raw,db,{record:vi.fn()});await expect(withCreditSubject({orgId,userId:'user'},()=>gateway.complete({...input,modelProvider:'open-deep-research',runId:'run'}))).rejects.toMatchObject({code:'credit_accounting_unavailable'});expect(complete).not.toHaveBeenCalled();});
 it('terminal accounting outage never repeats the paid request',async()=>{const {gateway,meter,dispatch}=setup();vi.mocked(meter.record).mockRejectedValue(new CreditConsumptionError('credit_accounting_unavailable','user','user'));await expect(withCreditSubject({orgId,userId:'user'},()=>gateway.complete(input))).rejects.toMatchObject({code:'credit_accounting_unavailable'});expect(dispatch).toHaveBeenCalledTimes(1);});
 it('observer start failure settles definitive zero before propagating original error',async()=>{const {gateway,meter,dispatch}=setup();const error=new CreditConsumptionError('credit_required','user','user');await expect(withCreditSubject({orgId,userId:'user'},()=>gateway.complete({...input,onProviderRequest:async()=>{throw error;}}))).rejects.toBe(error);expect(dispatch).not.toHaveBeenCalled();expect(meter.record).toHaveBeenCalledWith(orgId,expect.objectContaining({eventId:'req',totalSource:'reported',tokensTotal:0,promptTokens:0,completionTokens:0,outcome:'failed'}));});
 it('existing observer remains the one authoritative usage writer',async()=>{const {gateway,meter}=setup();const observer=vi.fn();await withCreditSubject({orgId,userId:'user'},()=>gateway.complete({...input,onProviderRequest:observer}));expect(observer).toHaveBeenCalledTimes(2);expect(meter.startRequest).toHaveBeenCalledTimes(1);expect(meter.record).not.toHaveBeenCalled();});
});
