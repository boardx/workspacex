import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,chmodSync,lstatSync,readFileSync,rmSync,realpathSync,symlinkSync,unlinkSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {safeStartupCode,parseStartupReceipt,writeStartupFailure,readStartupFailure,identityOperation} from './native-startup-receipt.mjs';
import {listenerObservationCount} from './runtime-attestation.mjs';

test('listener diagnostic counts actual nonempty observations without inventing PID zero',()=>{
  assert.equal(listenerObservationCount(''),0);assert.equal(listenerObservationCount(' \n\n'),0);
  assert.equal(listenerObservationCount('123\n'),1);assert.equal(listenerObservationCount('123\n456\n'),2);
  assert.throws(()=>listenerObservationCount(undefined));
});

test('identity suboperations retain original private cause while exposing only sole fixed codes',()=>{
  for(const code of ['IDENTITY_SOURCE','IDENTITY_CWD','IDENTITY_LISTENER','IDENTITY_ANCESTRY']){
    const original=new Error('private token SQL password path'),head='a'.repeat(40);
    let failure;try{identityOperation('IDENTITY_SOURCE',()=>identityOperation(code,()=>{throw original;}));}catch(error){failure=error;}
    assert.equal(failure.code,code);assert.equal(failure.cause,original);
    const receipt=parseStartupReceipt({phase:'IDENTITY',code:safeStartupCode(failure),status:'failed',sourceHead:head});
    assert.equal(JSON.stringify(receipt).includes('private'),false);assert.equal(receipt.code,code);
  }
  assert.throws(()=>identityOperation('private secret',()=>true));
  assert.equal(identityOperation('IDENTITY_CWD',()=>42),42);
});

test('optional real-child CWD context accepts only fixed safe values and preserves legacy receipts',()=>{
  const legacy={phase:'IDENTITY',code:'IDENTITY_CWD',status:'failed',sourceHead:'a'.repeat(40)};
  assert.deepEqual(parseStartupReceipt(legacy),legacy);
  const context={service:'web',pidAlive:true,commandExit:0,pathPresent:true,pathEqual:false,childExitCode:null,childSignal:null};
  const original=new Error('private environment token cwd stderr');
  let failure;try{identityOperation('IDENTITY_SOURCE',()=>identityOperation('IDENTITY_CWD',()=>{throw original;},context));}catch(error){failure=error;}
  assert.equal(failure.cause,original);assert.deepEqual(failure.identityCwd,context);
  const receipt=parseStartupReceipt({...legacy,identityCwd:{...failure.identityCwd,childExitCode:1}});
  assert.equal(JSON.stringify(receipt).includes('private'),false);
  for(const invalid of [{...context,service:'private'},{...context,path:'/private/secret'},{...context,pidAlive:'true'},{...context,commandExit:NaN},{...context,childExitCode:256},{...context,childSignal:'secret'}])assert.throws(()=>parseStartupReceipt({...legacy,identityCwd:invalid}));
  assert.throws(()=>parseStartupReceipt({...legacy,code:'IDENTITY_SOURCE',identityCwd:context}));
  let invalidDiagnosticFailure;
  try{identityOperation('IDENTITY_CWD',()=>{throw original;},{...context,commandExit:256});}catch(error){invalidDiagnosticFailure=error;}
  assert.equal(invalidDiagnosticFailure.code,'IDENTITY_CWD');assert.equal(invalidDiagnosticFailure.cause,original);assert.equal(invalidDiagnosticFailure.identityCwd,undefined);
  assert.equal(parseStartupReceipt({...legacy,identityCwd:{...context,pidAlive:null}}).identityCwd.pidAlive,null);
});

test('real import failure exposes only fixed phase and Node code, not its private message',async()=>{
  let failure;try{await import('file:///definitely-missing/native-private-module.mjs');}catch(error){failure=error;}
  assert.equal(safeStartupCode(failure),'ERR_MODULE_NOT_FOUND');
  assert.equal(safeStartupCode(new Error('password=private SQL secret URL token')),'UNKNOWN');
  assert.equal(safeStartupCode({get code(){throw new Error('private');}}),'UNKNOWN');
});

test('listener diagnostics preserve the private cause and never expose PID port paths or raw output',()=>{
  const legacy={phase:'IDENTITY',code:'IDENTITY_LISTENER',status:'failed',sourceHead:'a'.repeat(40)};
  assert.deepEqual(parseStartupReceipt(legacy),legacy);
  const context={service:'web',pidAlive:true,commandExit:1,listenerCount:null,allDescend:null,childExitCode:null,childSignal:null};
  const original=new Error('private token port PID stderr');let failure;
  try{identityOperation('IDENTITY_LISTENER',()=>{throw original;},context);}catch(error){failure=error;}
  assert.equal(failure.cause,original);assert.deepEqual(failure.identityListener,context);
  assert.deepEqual(parseStartupReceipt({...legacy,identityListener:context}).identityListener,context);
  for(const invalid of [{...context,pid:123},{...context,port:123},{...context,path:'/private'},{...context,raw:'token'},{...context,service:'postgres'},{...context,listenerCount:-1},{...context,listenerCount:4097},{...context,commandExit:256},{...context,allDescend:'true'}]){
    assert.throws(()=>parseStartupReceipt({...legacy,identityListener:invalid}));
    let rejected;try{identityOperation('IDENTITY_LISTENER',()=>{throw original;},invalid);}catch(error){rejected=error;}
    assert.equal(rejected.cause,original);assert.equal(rejected.identityListener,undefined);
  }
  assert.throws(()=>parseStartupReceipt({...legacy,code:'IDENTITY_CWD',identityListener:context}));
  assert.equal(JSON.stringify(parseStartupReceipt({...legacy,identityListener:context})).includes('private'),false);
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
