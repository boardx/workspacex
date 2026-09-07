import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {describe,it,expect} from 'vitest';
import {SubtaskSpawnInput,SubtaskSpawnOutput,parseSubtaskContextRefs} from '../src/standard-subtask-tools';
describe('native subtask shared boundary',()=>{
 it('generated Python boundary is fresh',()=>{execFileSync(process.execPath,['--import','tsx',fileURLToPath(new URL('../scripts/generate-standard-subtask-schema.ts',import.meta.url)),'--check']);});
 it('requires a stable idempotency key and keeps actual replay status',()=>{
  expect(()=>SubtaskSpawnInput.parse({description:'summarize'})).toThrow();
  expect(SubtaskSpawnOutput.parse({childRunId:'child',status:'completed'}).status).toBe('completed');
  expect(()=>SubtaskSpawnOutput.parse({childRunId:'child',status:'ready',artifactId:'invented'})).toThrow();
 });
 it('parses exact existing source/version references without identity fields',()=>{
  expect(parseSubtaskContextRefs(['{"sourceId":"chat-attachment:a","versionId":"sha256:abc"}'])).toEqual([{sourceId:'chat-attachment:a',versionId:'sha256:abc'}]);
  for(const bad of ['not-json','null','[]','{"sourceId":"a"}','{"sourceId":"a","versionId":"v","orgId":"foreign"}'])expect(()=>parseSubtaskContextRefs([bad])).toThrow();
 });
 it('rejects duplicate normalized references and unbounded payloads',()=>{
  const ref='{"sourceId":"a","versionId":"v"}';expect(()=>parseSubtaskContextRefs([ref,'{ "versionId":"v", "sourceId":"a" }'])).toThrow();
 expect(()=>SubtaskSpawnInput.parse({description:'x',idempotencyKey:'k',contextRefs:['x'.repeat(5000)]})).toThrow();
 });
 it('defaults to text-only and bounds explicitly delegated file outputs',()=>{
  expect(SubtaskSpawnInput.parse({description:'text',idempotencyKey:'text'}).outputFiles).toBeUndefined();
  expect(SubtaskSpawnInput.parse({description:'files',idempotencyKey:'files',outputFiles:{mediaTypes:['text/markdown'],maxFiles:2,maxTotalBytes:4096}}).outputFiles)
   .toEqual({mediaTypes:['text/markdown'],maxFiles:2,maxTotalBytes:4096});
  expect(()=>SubtaskSpawnInput.parse({description:'files',idempotencyKey:'files',outputFiles:{mediaTypes:[],maxFiles:1,maxTotalBytes:1}})).toThrow();
  expect(()=>SubtaskSpawnInput.parse({description:'files',idempotencyKey:'files',outputFiles:{mediaTypes:['application/octet-stream'],maxFiles:1,maxTotalBytes:1}})).toThrow();
 });
});
