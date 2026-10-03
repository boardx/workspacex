import assert from 'node:assert/strict';
import test from 'node:test';
import {assertImageIngressProofs,type ImageIngressProof} from '../../apps/web/e2e/support/board-image-ingress-proof.ts';
import {boardImagePngFixture} from '../../apps/web/e2e/support/board-image-fixture.ts';
const sha='a'.repeat(40),png=boardImagePngFixture();
// Synthetic validator inputs are counterproofs only; never browser acceptance receipts.
function inputs():ImageIngressProof[]{return (['https','close','navigate','revoke'] as const).map(group=>({group,runtime:{sha,buildSha:sha,dirty:false,deploymentMarker:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',chunks:[{sha256:'b'.repeat(64),localSha256:'b'.repeat(64)}]},png,persisted:png,canonicalBefore:[],canonicalAfter:group==='https'?[{},{}]:[],...(group==='revoke'?{deniedStatuses:[404,404]}:{}),...(group==='https'?{https:{certificateSha256:'c'.repeat(64),blockedHttps:[],browserFailures:['actual CORS failure'],requests:['no-cors','malformed-range','valid'].map(mode=>({mode,method:'GET',status:206,range:'bytes=0-26214399',bytes:mode==='malformed-range'?png.length-8:png.length}))}}:{})}));}
test('image proof contract rejects missing groups, byte drift, forged range and cancelled mutation',()=>{
 assert.equal(assertImageIngressProofs(inputs(),sha).length,4);
 const missing=inputs();missing.pop();assert.throws(()=>assertImageIngressProofs(missing,sha));
 const bytes=inputs();bytes[1].persisted=png.subarray(1);assert.throws(()=>assertImageIngressProofs(bytes,sha));
 const range=inputs();range[0].https!.requests[1].range='bytes=8-100';assert.throws(()=>assertImageIngressProofs(range,sha));
 const mutation=inputs();mutation[2].canonicalAfter=[{}];assert.throws(()=>assertImageIngressProofs(mutation,sha));
 const mismatch=inputs();mismatch[3].runtime.buildSha='d'.repeat(40);assert.throws(()=>assertImageIngressProofs(mismatch,sha));
 const tls=inputs();tls[0].https!.blockedHttps=['https://unowned.invalid'];assert.throws(()=>assertImageIngressProofs(tls,sha));
});
