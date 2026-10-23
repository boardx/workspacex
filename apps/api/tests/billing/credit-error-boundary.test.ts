import {type ArgumentsHost} from "@nestjs/common";
import {expect,it,vi} from "vitest";
import {AllExceptionsFilter} from "../../src/interface/filters/all-exceptions.filter";
import {CreditConsumptionError} from "../../src/application/billing/credit-consumption";
import {CreditRequiredBody} from "@repo/contracts/billing-consumption";
function response(error:unknown){
 const json=vi.fn<(value:unknown)=>void>(),status=vi.fn<(code:number)=>{json:typeof json}>(()=>({json}));
 const host={switchToHttp:()=>({getRequest:()=>({traceId:'credit-safe-trace'}),getResponse:()=>({status,json})})} as unknown as ArgumentsHost;
 const filter=new AllExceptionsFilter({info:vi.fn(),error:vi.fn()},{record:vi.fn().mockResolvedValue(undefined),list:vi.fn(),getLifecycle:vi.fn(),updateLifecycle:vi.fn()});
 filter.catch(error,host);return {status:status.mock.calls[0]?.[0],body:json.mock.calls[0]?.[0]};
}
it('returns typed insufficient-credit guidance without internal accounting details',()=>{
 const actual=response(new CreditConsumptionError('credit_required','user','credit-error-user'));
 expect(actual.status).toBe(402);expect(CreditRequiredBody.parse(actual.body)).toMatchObject({code:'credit_required',ownerType:'user',ownerId:'credit-error-user',rechargePath:'/billing?purchase=1',traceId:'credit-safe-trace'});
});
it('does not turn untrusted error text into a billing action',()=>{
 expect(response(new Error('credit_required: private SQL or provider content'))).toEqual({status:500,body:{error:'internal_error',traceId:'credit-safe-trace'}});
});
it('keeps a missing tariff or accounting outage distinct from insufficient balance',()=>{
 const actual=response(new CreditConsumptionError('credit_accounting_unavailable','team','credit-error-org'));
 expect(actual.status).toBe(503);expect(actual.body).toEqual({code:'credit_accounting_unavailable',traceId:'credit-safe-trace'});
});
