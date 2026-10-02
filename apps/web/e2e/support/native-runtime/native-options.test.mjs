import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeAcceptanceOptions,assertTemporaryRuntimePaths} from './runtime-attestation.mjs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const plan={ports:{web:36317,api:36320,postgres:36321},sourceHashes:{}};
test('default native producer options preserve direct WebSocket and no storage adapter',()=>{
 assert.deepEqual(nativeAcceptanceOptions(plan),{webSocketUrl:undefined,storagePath:undefined});
});
test('proxy build binds only validated independent loopback port',()=>{
 assert.equal(nativeAcceptanceOptions({...plan,proxyWebSocketPort:36322}).webSocketUrl,'ws://127.0.0.1:36322');
 for(const port of [80,65536,'36322',36320,NaN])assert.throws(()=>nativeAcceptanceOptions({...plan,proxyWebSocketPort:port}));
});
test('storage proof requires explicit option and committed adapter closure',()=>{
 assert.throws(()=>nativeAcceptanceOptions({...plan,fileStorageAttestation:true}));
 assert.throws(()=>nativeAcceptanceOptions({...plan,fileStorageAttestation:'true'}));
 assert.equal(nativeAcceptanceOptions({...plan,fileStorageAttestation:true,sourceHashes:{'apps/web/e2e/support/file-storage-runtime.mjs':'a'.repeat(64)}}).storagePath,'apps/web/e2e/support/file-storage-runtime.mjs');
});
test('portable temporary paths reject source-contained data and non-temporary roots',()=>{
 const root=join(tmpdir(),'candidate'),data=join(tmpdir(),'runtime-data');
 assert.doesNotThrow(()=>assertTemporaryRuntimePaths(root,data));
 for(const invalid of [root,join(root,'runtime'),resolve('/home/non-temporary-runtime')])assert.throws(()=>assertTemporaryRuntimePaths(root,invalid));
 assert.throws(()=>assertTemporaryRuntimePaths('/home/non-temporary-candidate',data));
});
