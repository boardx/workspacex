import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { assertImageStorageEvidence } from './board-durable-images-storage';
const boardIds=['source','target'],assetId='board-image-'+ 'a'.repeat(64);
function evidence(){return{assets:boardIds.map(boardId=>({boardId,key:`whiteboards/tenants/org/boards/${boardId}/assets/hash`,metadata:{assetId,persistence:'durable'},active:true})),documents:boardIds.map(boardId=>({boardId,key:`whiteboards/tenants/org/boards/${boardId}/snapshot`,hash:'a'.repeat(64),size:20,bodyIsNull:true})),inlineUpdates:0,binaryAssetColumns:0};}
test('metadata pointers for independent boards pass',()=>assert.doesNotThrow(()=>assertImageStorageEvidence(evidence(),boardIds,assetId)));
test('inline snapshot or update body fails',()=>{const value=evidence();value.documents[0]!.bodyIsNull=false;assert.throws(()=>assertImageStorageEvidence(value,boardIds,assetId));const update=evidence();update.inlineUpdates=1;assert.throws(()=>assertImageStorageEvidence(update,boardIds,assetId));});
test('duplicate borrowing source blob fails',()=>{const value=evidence();value.assets[1]!.key=value.assets[0]!.key;assert.throws(()=>assertImageStorageEvidence(value,boardIds,assetId));});
test('missing or inactive asset fails',()=>{const value=evidence();value.assets.pop();assert.throws(()=>assertImageStorageEvidence(value,boardIds,assetId));const inactive=evidence();inactive.assets[1]!.active=false;assert.throws(()=>assertImageStorageEvidence(inactive,boardIds,assetId));});
test('binary asset column fails',()=>{const value=evidence();value.binaryAssetColumns=1;assert.throws(()=>assertImageStorageEvidence(value,boardIds,assetId));});
