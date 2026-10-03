import test from 'node:test';
import assert from 'node:assert/strict';
import {multipart} from './board-file-security-multipart.mjs';

test('legacy multipart omits the optional field', () => {
  const body=multipart('bytes','legacy%22.txt');
  assert.equal(body.has('fileName'),false);
  assert.equal(body.get('file').name,'legacy%22.txt');
  assert.deepEqual([...body.keys()],['file']);
});
test('approved raw field preserves special names without percent decoding', async () => {
  for (const name of ['"quoted".txt','literal%22.txt','star*.txt',"it's.txt",'final(1).txt','普通便利贴.txt','100%.txt']) {
    const body=multipart('bytes',name,'text/html',true);
    assert.deepEqual(body.getAll('fileName'),[name]);
    assert.equal(body.get('file').name,name);
    const request=new Request('http://localhost/unused',{method:'POST',body});
    const bytes=await request.text();
    assert(bytes.includes(`name="fileName"\r\n\r\n${name}\r\n`));
    if(name==='"quoted".txt') assert(bytes.includes('filename="%22quoted%22.txt"'));
  }
});
