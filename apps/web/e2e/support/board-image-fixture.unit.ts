import assert from 'node:assert/strict';
import test from 'node:test';
import {inflateSync} from 'node:zlib';
import {boardImagePngFixture} from './board-image-fixture';

test('board image fixture is a decodable 64 x 48 RGB PNG',()=>{
  const png=boardImagePngFixture();
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  const chunks=new Map<string,Buffer>();
  for(let offset=8;offset<png.length;){
    const length=png.readUInt32BE(offset),name=png.toString('ascii',offset+4,offset+8);
    chunks.set(name,png.subarray(offset+8,offset+8+length));
    offset+=12+length;
  }
  const header=chunks.get('IHDR');
  assert.ok(header);
  assert.equal(header.readUInt32BE(0),64);
  assert.equal(header.readUInt32BE(4),48);
  assert.equal(header[8],8);
  assert.equal(header[9],2);
  const image=chunks.get('IDAT');
  assert.ok(image);
  const pixels=inflateSync(image);
  assert.equal(pixels.length,48*(1+64*3));
  assert.deepEqual([...pixels.subarray(1,4)],[231,29,73]);
});
