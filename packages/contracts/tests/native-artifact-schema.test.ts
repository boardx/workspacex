import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {NativeArtifactPublishInput,NativeArtifactStaged} from '../src/native-artifact-publish';
it('shared artifact schema remains fresh and does not fake readiness',()=>{
 execFileSync(process.execPath,['--import','tsx','scripts/generate-native-artifact-schema.ts','--check'],{cwd:new URL('..',import.meta.url)});
 expect(NativeArtifactStaged.safeParse({status:'ready'}).success).toBe(false);
 expect(NativeArtifactPublishInput.safeParse({workspacePath:'/workspace/a.txt',title:'a.txt',mediaType:'text/plain',idempotencyKey:'one',sourceRefs:[]}).success).toBe(false);
});
