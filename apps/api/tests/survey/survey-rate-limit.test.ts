import { expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { SurveySubmissionRateLimitGuard } from '../../src/interface/guards/survey-submission-rate-limit.guard';
it('checks anonymous submissions with the shared IP limiter and fails closed',async()=>{
  const keys:string[]=[];const guard=new SurveySubmissionRateLimitGuard({async hit(key){keys.push(key);return {allowed:false,retryAfterMs:1000};}});
  const ctx={switchToHttp:()=>({getRequest:()=>({ip:'192.0.2.1'})})} as unknown as ExecutionContext;
  await expect(guard.canActivate(ctx)).rejects.toMatchObject({status:429});expect(keys).toEqual(['survey-submission:192.0.2.1']);
});
