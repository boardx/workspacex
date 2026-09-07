import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {NativeInputManifest} from '../src/native-session-binding';
import {NativeFileDelegationCheckInput,NativeFileDelegationCheckOutput} from '../src/native-file-delegation';
const options={target:'jsonSchema7',$refStrategy:'none'} as const;
const value=JSON.stringify({manifest:zodToJsonSchema(NativeInputManifest,options),input:zodToJsonSchema(NativeFileDelegationCheckInput,options),output:zodToJsonSchema(NativeFileDelegationCheckOutput,options)},null,2)+'\n';
const path=resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/native_file_delegation_schema.json');
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==value)throw new Error('native file delegation schema stale');}else writeFileSync(path,value);
