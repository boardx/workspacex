import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {SkillDraftInput,SkillDraftOutput,SkillDraftInvocation,SKILL_DRAFT_LIMITS,SKILL_DRAFT_TOOL,SkillArtifactImportInput} from '../src/standard-skill-draft';
it('generated skill draft contract is exact',()=>{const options={target:'jsonSchema7',$refStrategy:'none'} as const;expect(JSON.parse(readFileSync(new URL('../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_skill_draft_schema.json',import.meta.url),'utf8'))).toEqual({toolName:SKILL_DRAFT_TOOL,limits:SKILL_DRAFT_LIMITS,toolInput:zodToJsonSchema(SkillDraftInput,options),input:zodToJsonSchema(SkillDraftInvocation,options),output:zodToJsonSchema(SkillDraftOutput,options)});});
it('admin import accepts artifact identity, not URLs or storage keys',()=>{const good={artifactId:'a',version:1,expectedDigest:'a'.repeat(64),idempotencyKey:'i'};expect(SkillArtifactImportInput.safeParse(good).success).toBe(true);for(const extra of [{storageKey:'secret'},{url:'https://example.test'},{orgId:'other'}])expect(SkillArtifactImportInput.safeParse({...good,...extra}).success).toBe(false);});
