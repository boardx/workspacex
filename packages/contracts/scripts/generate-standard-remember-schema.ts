/** issue #4344：`wx_remember` 跨语言单源——Python 侧只读这份生成物（tests/standard-remember.test.ts 逐字核对）。 */
import {readFileSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';import {zodToJsonSchema} from 'zod-to-json-schema';
import {RememberFailureCode,RememberInput,RememberOutput,STANDARD_REMEMBER_LIMITS,STANDARD_REMEMBER_TOOL,StandardRememberInvocation} from '../src/standard-remember';
const opts={target:'jsonSchema7',$refStrategy:'none'} as const;
const content=JSON.stringify({toolName:STANDARD_REMEMBER_TOOL,input:zodToJsonSchema(StandardRememberInvocation,opts),toolInput:zodToJsonSchema(RememberInput,opts),toolOutput:zodToJsonSchema(RememberOutput,opts),failureCodes:RememberFailureCode.options,limits:STANDARD_REMEMBER_LIMITS},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_remember_schema.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('standard remember schema stale: run `pnpm --filter @repo/contracts exec tsx scripts/generate-standard-remember-schema.ts`');}
else writeFileSync(path,content);
