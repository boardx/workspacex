import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {RememberFailureCode,RememberInput,RememberOutput,STANDARD_REMEMBER_LIMITS,STANDARD_REMEMBER_TOOL,StandardRememberInvocation} from '../src/standard-remember';

describe('issue #4344 wx_remember single-source protocol',()=>{
 it('Python artifact exactly matches the current schemas, failure codes and limits',()=>{
  const opts={target:'jsonSchema7',$refStrategy:'none'} as const;
  const actual=JSON.parse(readFileSync(resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_remember_schema.json'),'utf8'));
  expect(actual).toEqual({toolName:STANDARD_REMEMBER_TOOL,input:zodToJsonSchema(StandardRememberInvocation,opts),toolInput:zodToJsonSchema(RememberInput,opts),
   toolOutput:zodToJsonSchema(RememberOutput,opts),failureCodes:RememberFailureCode.options,limits:STANDARD_REMEMBER_LIMITS});
 });
 it('the model supplies only the statement: any id it adds is a contract violation, not silently ignored',()=>{
  expect(RememberInput.safeParse({statement:'我的目标是今年跑完半马'}).success).toBe(true);
  for(const forged of [{sourceMessageId:'m-other'},{threadId:'t-other'},{userId:'u-other'},{runId:'r-other'}]){
   expect(RememberInput.safeParse({statement:'我的目标是今年跑完半马',...forged}).success).toBe(false);
  }
  expect(RememberInput.safeParse({statement:'   '}).success).toBe(false);
  expect(RememberInput.safeParse({statement:'x'.repeat(2001)}).success).toBe(false);
  expect(StandardRememberInvocation.safeParse({orgId:'o',attemptId:'r:0',leaseEpoch:1,toolCallId:'c',toolName:'wx_remember',toolArgs:{statement:'喜欢中文回答'}}).success).toBe(true);
 });
 it('every result says nothing was saved yet',()=>{
  expect(RememberOutput.safeParse({outcome:'card_opened',cardId:'card-1',statement:'s',saved:true,instruction:'i'}).success).toBe(false);
  expect(RememberOutput.safeParse({outcome:'refused',code:'not_personal_thread',saved:false,instruction:'i'}).success).toBe(true);
 });
});
