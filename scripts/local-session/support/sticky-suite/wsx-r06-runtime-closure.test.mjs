import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import {collectStickyRuntimeClosure,assertRequiredRuntimeSourceHashes} from './wsx-r06-runtime-closure.mjs';
test('real R04 dependency closure preserves Nav32 and workspace export aliases',async()=>{
 const root=fileURLToPath(new URL('../../../../',import.meta.url)),{sourceFiles}=await import(root+'/scripts/local-session/board-navigation-acceptance-runtime.mjs');
 const closure=collectStickyRuntimeClosure(root,sourceFiles);assert(closure.length>sourceFiles.length);for(const path of sourceFiles)assert(closure.includes(path));
 assert(closure.includes('packages/fabric-markdown/src/templates-entry.ts'));assert(closure.includes('packages/contracts/src/whiteboard-document.ts'));assert(closure.includes('apps/web/lib/whiteboard-provider.ts'));
});
test('manifest omission or fake source hash cannot satisfy required closure',()=>{
 const required=['board-header.tsx','provider.ts'],sourceHashes=Object.fromEntries(required.map(path=>[path,'a'.repeat(64)]));assertRequiredRuntimeSourceHashes({sourceHashes},required);
 assert.throws(()=>assertRequiredRuntimeSourceHashes({sourceHashes:{'board-header.tsx':'a'.repeat(64)}},required),/provider/);
 assert.throws(()=>assertRequiredRuntimeSourceHashes({sourceHashes:{...sourceHashes,'provider.ts':'fake'}},required),/provider/);
});
