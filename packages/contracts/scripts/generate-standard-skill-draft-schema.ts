import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {SkillDraftInput,SkillDraftOutput,SkillDraftInvocation,SKILL_DRAFT_LIMITS,SKILL_DRAFT_TOOL} from '../src/standard-skill-draft';
const options={target:'jsonSchema7',$refStrategy:'none'} as const;
const content=JSON.stringify({toolName:SKILL_DRAFT_TOOL,limits:SKILL_DRAFT_LIMITS,toolInput:zodToJsonSchema(SkillDraftInput,options),input:zodToJsonSchema(SkillDraftInvocation,options),output:zodToJsonSchema(SkillDraftOutput,options)},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_skill_draft_schema.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('skill draft schema stale');}else writeFileSync(path,content);
