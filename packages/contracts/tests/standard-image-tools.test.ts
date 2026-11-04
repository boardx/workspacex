import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {ImageGenerateInput,ImageGenerated,ImageGenerateInvocation,IMAGE_GENERATE_LIMITS,IMAGE_GENERATE_TOOL} from '../src/standard-image-tools';
it('image schema preserves approved input fields without invented publication identity',()=>{const good={prompt:'image',sizeProfile:'square',idempotencyKey:'intent'};expect(ImageGenerateInput.parse(good)).toEqual(good);expect(ImageGenerateInput.safeParse({...good,sizeProfile:'wide'}).success).toBe(false);expect(ImageGenerateInput.safeParse({...good,referencePaths:['/secret']}).success).toBe(false);expect(ImageGenerated.shape).not.toHaveProperty('artifactId');});
it('generated Python image schema is exact',()=>{const options={target:'jsonSchema7',$refStrategy:'none'} as const;expect(JSON.parse(readFileSync(new URL('../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_image_schema.json',import.meta.url),'utf8'))).toEqual({toolName:IMAGE_GENERATE_TOOL,limits:IMAGE_GENERATE_LIMITS,toolInput:zodToJsonSchema(ImageGenerateInput,options),input:zodToJsonSchema(ImageGenerateInvocation,options),output:zodToJsonSchema(ImageGenerated,options)});});
it('keeps legacy square input and supports fixed HD/icon profile mapping without arbitrary model overrides',async()=>{
 const {resolveImageProfile}=await import('../src/standard-image-tools');
 expect(resolveImageProfile({sizeProfile:'square'})).toEqual({modelId:'qwen-image-3.0',dimension:1024});
 expect(resolveImageProfile({sizeProfile:'square-hd'})).toEqual({modelId:'qwen-image-3.0-pro',dimension:2048});
 expect(()=>resolveImageProfile({sizeProfile:'square-hd',generationProfile:'icon'})).toThrow('image_profile_conflict');
 expect(ImageGenerateInput.safeParse({prompt:'icon',sizeProfile:'square',generationProfile:'icon',idempotencyKey:'icon'}).success).toBe(true);
 expect(ImageGenerateInput.safeParse({prompt:'icon',sizeProfile:'square',modelId:'unpriced-model',idempotencyKey:'icon'}).success).toBe(false);
});
