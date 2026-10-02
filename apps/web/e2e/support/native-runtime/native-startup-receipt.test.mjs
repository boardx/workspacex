import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,chmodSync,lstatSync,readFileSync,rmSync,realpathSync,symlinkSync,unlinkSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {safeStartupCode,parseStartupReceipt,writeStartupFailure,readStartupFailure} from './native-startup-receipt.mjs';

test('real import failure exposes only fixed phase and Node code, not its private message',async()=>{
  let failure;try{await import('file:///definitely-missing/native-private-module.mjs');}catch(error){failure=error;}
  assert.equal(safeStartupCode(failure),'ERR_MODULE_NOT_FOUND');
  assert.equal(safeStartupCode(new Error('password=private SQL secret URL token')),'UNKNOWN');
  assert.equal(safeStartupCode({get code(){throw new Error('private');}}),'UNKNOWN');
});
test('startup receipt rejects extra/private fields and unknown schema values',()=>{
  const valid={phase:'IMPORT',code:'ERR_MODULE_NOT_FOUND',status:'failed',sourceHead:'a'.repeat(40)};
  parseStartupReceipt(valid);
  for(const invalid of [{...valid,raw:'secret'},{...valid,phase:'private SQL'},{...valid,code:'private token'},{...valid,status:'passed'},{...valid,sourceHead:'not-source'},{...valid,sourceHead:null}])assert.throws(()=>parseStartupReceipt(invalid));
});
test('atomic failure receipt is private, immutable evidence and distinguishes assertion phase',()=>{
  const data=realpathSync(mkdtempSync(join(tmpdir(),'wsx-native-receipt-')));chmodSync(data,0o700);
  try{
    let failure;try{assert.equal(1,2,'private SQL and token');}catch(error){failure=error;}
    writeStartupFailure({data,phase:'ROLE',sourceHead:'b'.repeat(40),error:failure});
    const path=join(data,'native-startup-failure.json');assert.equal(lstatSync(path).mode&0o777,0o600);
    assert.deepEqual(readStartupFailure(data),{phase:'ROLE',code:'ERR_ASSERTION',status:'failed',sourceHead:'b'.repeat(40)});
    assert(!readFileSync(path,'utf8').includes('token'));
    assert.throws(()=>writeStartupFailure({data,phase:'BUILD',sourceHead:null,error:failure}));
    chmodSync(path,0o644);assert.throws(()=>readStartupFailure(data));
  }finally{rmSync(data,{recursive:true});}
});
test('reader rejects public data directories, ancestor aliases and receipt symlinks',()=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'wsx-native-reader-'))),data=join(root,'data');mkdirSync(data,{mode:0o700});
  try{
    writeStartupFailure({data,phase:'API',sourceHead:'c'.repeat(40),error:new Error('private')});
    chmodSync(data,0o755);assert.throws(()=>readStartupFailure(data));chmodSync(data,0o700);
    chmodSync(root,0o755);assert.throws(()=>readStartupFailure(data));chmodSync(root,0o700);
    const alias=join(root,'alias');symlinkSync(data,alias);assert.throws(()=>readStartupFailure(alias));
    const ancestorAlias=join(root,'ancestor-alias');symlinkSync(root,ancestorAlias);assert.throws(()=>readStartupFailure(join(ancestorAlias,'data')));
    const path=join(data,'native-startup-failure.json'),bytes=readFileSync(path);unlinkSync(path);
    const target=join(data,'other.json');writeFileSync(target,bytes,{mode:0o600});symlinkSync(target,path);assert.throws(()=>readStartupFailure(data));
  }finally{rmSync(root,{recursive:true});}
});
