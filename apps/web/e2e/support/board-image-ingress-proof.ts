import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export type ImageIngressProof = {
 group:'https'|'close'|'navigate'|'revoke';
 runtime:{sha:string;buildSha:string;dirty:boolean;deploymentMarker:string;chunks:Array<{sha256:string;localSha256:string}>};
 png:Buffer;persisted:Buffer;canonicalBefore:unknown[];canonicalAfter:unknown[];
 deniedStatuses?:number[];
 https?:{certificateSha256:string;blockedHttps:string[];browserFailures:string[];requests:Array<{mode:string;method:string;status:number;range?:string;bytes:number}>};
};
/** Four independent real browser groups; never substitutes canonical storage receipts. */
export function assertImageIngressProofs(rows:ImageIngressProof[],expectedSha:string){
 assert.deepEqual(rows.map(row=>row.group).sort(),['close','https','navigate','revoke']);
 for(const row of rows){
  assert.equal(row.runtime.sha,expectedSha);assert.equal(row.runtime.buildSha,expectedSha);assert.equal(row.runtime.dirty,false);
  assert.match(row.runtime.deploymentMarker,/^[a-f0-9-]{36}$/);assert(row.runtime.chunks.length>0);
  for(const chunk of row.runtime.chunks){assert.match(chunk.sha256,/^[a-f0-9]{64}$/);assert.equal(chunk.sha256,chunk.localSha256);}
  assert(Buffer.isBuffer(row.png));assert(Buffer.isBuffer(row.persisted));assert(row.png.length>8);
  assert(row.png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));assert.deepEqual(row.persisted,row.png);
  if(row.group==='https'){
   assert.equal(row.canonicalBefore.length,0);assert.equal(row.canonicalAfter.length,2);
   const proof=row.https;assert(proof);assert.match(proof.certificateSha256,/^[a-f0-9]{64}$/);assert.deepEqual(proof.blockedHttps,[]);assert(proof.browserFailures.length>0);
   for(const mode of ['no-cors','malformed-range','valid'])assert(proof.requests.some(r=>r.method==='GET'&&r.mode===mode&&r.status===206&&r.range==='bytes=0-26214399'&&r.bytes===(mode==='malformed-range'?row.png.length-8:row.png.length)));
  }else{
   assert.deepEqual(row.canonicalBefore,[]);assert.deepEqual(row.canonicalAfter,row.canonicalBefore);
   if(row.group==='revoke')assert.deepEqual(row.deniedStatuses,[404,404]);
  }
 }
 return rows.map(row=>({group:row.group,sha:row.runtime.sha,pngSha256:createHash('sha256').update(row.persisted).digest('hex')}));
}
