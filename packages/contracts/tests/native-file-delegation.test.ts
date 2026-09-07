import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {NativeFileDelegationCheckInput,NativeFileDelegationCheckOutput} from '../src/native-file-delegation';
import {NativeInputManifest} from '../src/native-session-binding';
const file={attachmentId:'attachment',filename:'a.txt',path:'/inputs/'+'a'.repeat(64)+'/a.txt',mediaType:'text/plain',sizeBytes:1,digest:'b'.repeat(64)};
const body={orgId:'org',attemptId:'run:0',leaseEpoch:1,toolCallId:'actual-child-read',toolName:'read_file',toolArgs:{file_path:file.path},file};
describe('native file delegation contract',()=>{
 it('only accepts read_file and attested native input paths',()=>{
  expect(NativeFileDelegationCheckInput.parse(body)).toEqual(body);
  for(const changed of [{toolName:'execute'},{file:{...file,path:'/workspace/other'}},{namespace:'other'},{file:{...file,storageRef:'private'}}])expect(NativeFileDelegationCheckInput.safeParse({...body,...changed}).success).toBe(false);
  expect(NativeFileDelegationCheckOutput.safeParse({allowed:false}).success).toBe(false);
 });
 it('keeps Python validators generated from the shared source',()=>{
  const options={target:'jsonSchema7',$refStrategy:'none'} as const;
  const actual=JSON.parse(readFileSync(resolve(import.meta.dirname,'../../../apps/deep-agent-service/src/deep_agent_service/generated/native_file_delegation_schema.json'),'utf8'));
  expect(actual).toEqual({manifest:zodToJsonSchema(NativeInputManifest,options),input:zodToJsonSchema(NativeFileDelegationCheckInput,options),output:zodToJsonSchema(NativeFileDelegationCheckOutput,options)});
 });
});
