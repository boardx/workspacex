import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {NativeArtifactPublishInput,NativeArtifactStageInput,NativeArtifactStaged,NATIVE_ARTIFACT_TOOL} from '../src/native-artifact-publish';
const opts={target:'jsonSchema7',$refStrategy:'none'} as const;
const content=JSON.stringify({toolName:NATIVE_ARTIFACT_TOOL,toolInput:zodToJsonSchema(NativeArtifactPublishInput,opts),input:zodToJsonSchema(NativeArtifactStageInput,opts),output:zodToJsonSchema(NativeArtifactStaged,opts)},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/native_artifact_schema.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('native artifact schema stale');}else writeFileSync(path,content);
