import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {AudioTranscribeInput,AudioTranscribed,AudioTranscribeInvocation,AUDIO_TRANSCRIBE_LIMITS,AUDIO_TRANSCRIBE_TOOL} from '../src/standard-audio-tools';
const options={target:'jsonSchema7',$refStrategy:'none'} as const;
const content=JSON.stringify({toolName:AUDIO_TRANSCRIBE_TOOL,limits:AUDIO_TRANSCRIBE_LIMITS,toolInput:zodToJsonSchema(AudioTranscribeInput,options),input:zodToJsonSchema(AudioTranscribeInvocation,options),output:zodToJsonSchema(AudioTranscribed,options)},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_audio_schema.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error('audio schema stale');}else writeFileSync(path,content);
