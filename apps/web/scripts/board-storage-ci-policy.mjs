import {readFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
import {validateRuntimeBinding} from './board-observation-policy.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>assert.match(value,/^[a-f0-9]{64}$/);
/** Validate persisted bytes, not reporter booleans or merely test counts. */
export async function validateStorageCiEvidence(report,sha,context,output){
 const failures=[],pending=['real-account-vendor-exports','complete-storage-lifecycle-matrix'];
 try{
  const {assertImageStorageEvidence}=await tsImport(new URL('../e2e/support/board-durable-images-storage.ts',import.meta.url).href,import.meta.url);
  const {loadVendorSchemaFixture}=await tsImport(new URL('../e2e/support/board-vendor-schema-fixtures.ts',import.meta.url).href,import.meta.url);
  const rows=report.suites.flatMap(s=>s.specs.flatMap(s=>s.tests));assert.equal(rows.length,4);
  const seen=new Set();
  for(const row of rows){
   const attachments=row.results[0].attachments;assert(Array.isArray(attachments));const names=new Set();const data=new Map();
   for(const a of attachments){assert(!names.has(a.name));names.add(a.name);assert(resolve(a.path).startsWith(resolve(output)+sep));const bytes=readFileSync(a.path);assert.equal(bytes.length,a.bytes);assert.equal(hash(bytes),a.sha256);data.set(a.name,a.name.endsWith('.png')?bytes:JSON.parse(bytes.toString()));}
   const runtime=data.get('storage-runtime.json');assert(runtime);assert(!seen.has(runtime.scenario));seen.add(runtime.scenario);failures.push(...validateRuntimeBinding(runtime.runtimeIdentity,sha,context));
   if(runtime.scenario==='durable-images'){
    const initial=data.get('pg-independent-pointers'),after=data.get('pg-target-after-source-delete');assert(initial&&after);assert.equal(initial.documents.length,2);assert.equal(new Set(initial.documents.map(d=>d.boardId)).size,2);assert(initial.documents.some(d=>d.boardId===runtime.targetBoardId));
    assertImageStorageEvidence(initial,initial.documents.map(d=>d.boardId),runtime.assetId);assertImageStorageEvidence(after,[runtime.targetBoardId],runtime.assetId);
    const canonical=data.get('canonical-upload');assert(canonical.objects.some(o=>o.kind==='image'&&o.extensionData?.contentObject?.assetId===runtime.assetId));
   }else{
    assert(['miro-workshop','mural-diagram','miro-media'].includes(runtime.scenario));const fixture=await loadVendorSchemaFixture(runtime.scenario),e=data.get('migration-evidence.json');assert(e);assert.equal(e.sourceHash,fixture.sha256);assert.equal(e.classification,'schema-derived-synthetic');assert.equal(e.realBoardAcceptance,'diagnostic-only');assert.notEqual(e.boardId,e.roundtripBoardId);
    assert.equal(e.replay.replayed,true);assert.equal(e.replay.seq,e.accepted.seq);assert.deepEqual(e.report,e.accepted.report);assert.equal(e.report.executable,true);assert.equal(e.report.items.length,fixture.expected.length);for(const expected of fixture.expected){const matches=e.report.items.filter(i=>i.sourceId===expected.sourceId);assert.equal(matches.length,1);assert.equal(matches[0].outcome,expected.outcome);if(expected.reasonCode)assert.equal(matches[0].reasonCode,expected.reasonCode);}
    const l=e.localEvidence,p=e.portableEvidence;assert.equal(l.objectCount,fixture.expected.filter(i=>['success','downgraded'].includes(i.outcome)).length);digest(l.initialHash);assert.equal(l.initialHash,l.reloadedHash);assert.equal(l.initialHash,l.peerHash);digest(p.ownerLocalHash);assert.equal(p.ownerLocalHash,p.peerLocalHash);digest(p.bundleSha256);assert.equal(p.replay.replayed,true);assert.equal(p.replay.seq,p.accepted.seq);assert.equal(p.replay.epoch,p.accepted.epoch);
    assert.equal(e.images.length,fixture.media.length);assert.equal(p.media.length,fixture.media.length);for(const m of fixture.media){assert(e.images.some(i=>i.sha256===m.sha256&&/^[a-f0-9]{64}$/.test(i.pixelHash)));assert(p.media.some(i=>i.sourceId===m.sourceId&&i.sha256===m.sha256&&i.sizeBytes>0));}
    for(const name of ['owner-after-refresh.png','independent-peer.png','roundtrip-owner-after-refresh.png','roundtrip-independent-peer.png']){const png=data.get(name);assert(Buffer.isBuffer(png)&&png.length>8);assert(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));}
   }
  }
  assert.deepEqual([...seen].sort(),['durable-images','miro-media','miro-workshop','mural-diagram'].sort());
 }catch{failures.push('STORAGE_EVIDENCE_INVALID');}
 return{valid:failures.length===0,failures,pending};
}
