import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {ArtifactDownloadInput,ArtifactDownloadOutput,STANDARD_ARTIFACT_DOWNLOAD_TOOL,StandardArtifactDownloadInvocation} from '../src/standard-artifact-download';
const opts={target:'jsonSchema7',$refStrategy:'none'} as const;
const content=JSON.stringify({toolName:STANDARD_ARTIFACT_DOWNLOAD_TOOL,input:zodToJsonSchema(StandardArtifactDownloadInvocation,opts),toolInput:zodToJsonSchema(ArtifactDownloadInput,opts),toolOutput:zodToJsonSchema(ArtifactDownloadOutput,opts),limits:{deadlineMs:30000,maxResponseBytes:65536}},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_artifact_download_schema.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('standard artifact download schema stale');}else writeFileSync(path,content);
