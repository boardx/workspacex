import {describe,expect,it} from "vitest";
import {Observable,firstValueFrom} from "rxjs";
import type {ExecutionContext,CallHandler} from "@nestjs/common";
import {currentCreditSubject,withCreditSubject} from "../../src/application/billing/credit-execution-context";
import {CreditExecutionContextInterceptor} from "../../src/interface/interceptors/credit-execution-context.interceptor";
import {toOrgId} from "../../src/domain/org-id";
const subject={userId:'u1',orgId:toOrgId('credit-context-org')};
describe('trusted credit context',()=>{
 it('isolates interleaved asynchronous request owners',async()=>{
  const values=await Promise.all(['one','two'].map(userId=>withCreditSubject({...subject,userId},async()=>{await new Promise(r=>setTimeout(r,userId==='one'?8:1));return currentCreditSubject()?.userId;})));
  expect(values).toEqual(['one','two']);expect(currentCreditSubject()).toBeUndefined();
 });
 it('binds lazy Nest observable subscription, not just handle creation',async()=>{
  const context={switchToHttp:()=>({getRequest:()=>({principal:subject})})} as unknown as ExecutionContext;
  const next={handle:()=>new Observable(subscriber=>{setTimeout(()=>{subscriber.next(currentCreditSubject());subscriber.complete();},1);})} as CallHandler;
  const result=await firstValueFrom(new CreditExecutionContextInterceptor().intercept(context,next));
  expect(result).toEqual(subject);expect(currentCreditSubject()).toBeUndefined();
 });
});
