import assert from 'node:assert/strict';
import test from 'node:test';
import { request } from 'node:https';
import { startImageFixture } from './board-image-https-fixture.mts';
import { boardImagePngFixture } from '../../apps/web/e2e/support/board-image-fixture.ts';
function read(url: string, origin: string) { return new Promise<{status:number; headers:Record<string,string|string[]|undefined>; body:Buffer}>((resolve,reject) => {
  const req=request(url,{rejectUnauthorized:false,headers:{Origin:origin,Range:'bytes=0-26214399'}},response=>{const parts:Buffer[]=[];response.on('data',chunk=>parts.push(chunk));response.on('end',()=>resolve({status:response.statusCode!,headers:response.headers,body:Buffer.concat(parts)}));});req.on('error',reject);req.end();
}); }
test('owned HTTPS fixture preserves actual PNG bytes, exact-origin CORS and malformed range', async () => {
 const png=boardImagePngFixture(),origin='http://127.0.0.1:3100',fixture=await startImageFixture(png,origin);
 try {
  const valid=await read(fixture.url,origin);assert.equal(valid.status,206);assert.deepEqual(valid.body,png);assert.equal(valid.headers['access-control-allow-origin'],origin);assert.equal(valid.headers['content-range'],`bytes 0-${png.length-1}/${png.length}`);
  const other=await read(fixture.url,'http://127.0.0.1:3101');assert.equal(other.headers['access-control-allow-origin'],undefined);
  fixture.setMode('no-cors');assert.equal((await read(fixture.url,origin)).headers['access-control-allow-origin'],undefined);
  fixture.setMode('malformed-range');const malformed=await read(fixture.url,origin);assert.deepEqual(malformed.body,png.subarray(8));assert.equal(malformed.headers['content-range'],`bytes 8-${png.length-1}/${png.length}`);
  assert.equal(fixture.receipts.length,4);assert.ok(fixture.receipts.every(item=>item.range==='bytes=0-26214399'));
 } finally { await fixture.close(); }
 await assert.rejects(read(fixture.url,origin));
});
