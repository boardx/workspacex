import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {ImageGenerateInput,ImageGenerated,ImageGenerateInvocation,IMAGE_GENERATE_LIMITS,IMAGE_GENERATE_TOOL} from '../src/standard-image-tools';
const options={target:'jsonSchema7',$refStrategy:'none'} as const;
const content=JSON.stringify({toolName:IMAGE_GENERATE_TOOL,limits:IMAGE_GENERATE_LIMITS,toolInput:zodToJsonSchema(ImageGenerateInput,options),input:zodToJsonSchema(ImageGenerateInvocation,options),output:zodToJsonSchema(ImageGenerated,options)},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_image_schema.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('image schema stale');}else writeFileSync(path,content);
