import { expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { SurveySubmissionRateLimitGuard } from '../../src/interface/guards/survey-submission-rate-limit.guard';
const context=(peer:string,token:string,realIp?:string,xff?:string)=>({switchToHttp:()=>({getRequest:()=>({ip:peer,socket:{remoteAddress:peer},params:{token},headers:{'x-real-ip':realIp,'x-forwarded-for':xff}})})}) as unknown as ExecutionContext;
it('isolates respondents and surveys behind the trusted loopback ingress',async()=>{
 const counts=new Map<string,number>();const guard=new SurveySubmissionRateLimitGuard({async hit(key){const n=(counts.get(key)??0)+1;counts.set(key,n);return {allowed:n<=2,retryAfterMs:1000};}});
 const a=context('127.0.0.1','survey-a','192.0.2.1');await guard.canActivate(a);await guard.canActivate(a);await expect(guard.canActivate(a)).rejects.toMatchObject({status:429});
 await expect(guard.canActivate(context('127.0.0.1','survey-a','192.0.2.2'))).resolves.toBe(true);
 await expect(guard.canActivate(context('127.0.0.1','survey-b','192.0.2.1'))).resolves.toBe(true);
 expect(counts.size).toBe(3);
});
it('ignores forged forwarding headers from untrusted peers and malformed ingress addresses',async()=>{
 const keys:string[]=[];const guard=new SurveySubmissionRateLimitGuard({async hit(key){keys.push(key);return {allowed:true,retryAfterMs:0};}});
 await guard.canActivate(context('192.0.2.4','secret-token','198.51.100.1','198.51.100.2'));
 await guard.canActivate(context('192.0.2.4','secret-token','203.0.113.1','203.0.113.2'));
 expect(keys[0]).toBe(keys[1]);expect(keys[0]).not.toContain('secret-token');
 await guard.canActivate(context('::ffff:127.0.0.1','secret-token','bad, address'));
 await guard.canActivate(context('::ffff:127.0.0.1','secret-token',undefined,'1.2.3.4'));
 expect(keys[2]).toBe(keys[3]);
});
