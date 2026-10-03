import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,lstatSync,symlinkSync,mkdirSync,chmodSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createPrivateEvidenceDirectory,writeSafeFailure} from './wsx-r06-private-evidence.mjs';

test('evidence is fresh, physically owned and private with a fixed public failure receipt',()=>{
 const parent=mkdtempSync('/private/tmp/wsx-r06-evidence-test-');
 try{
  const out=createPrivateEvidenceDirectory(join(parent,'fresh'));
  assert.equal(lstatSync(out).mode&0o777,0o700);
  writeSafeFailure(out,'source-preflight');
  const file=join(out,'public-failure.json');assert.equal(lstatSync(file).mode&0o777,0o600);
  assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),{status:'failed',requiredSuiteComplete:false,phase:'source-preflight',code:'STICKY_SUITE_FAILURE'});
  assert.throws(()=>createPrivateEvidenceDirectory(out),/EEXIST/);
 }finally{rmSync(parent,{recursive:true,force:true});}
});
test('symlink ancestors and unprotected writable parents cannot authorize an output directory',()=>{
 const parent=mkdtempSync('/private/tmp/wsx-r06-evidence-test-');
 try{
  const actual=join(parent,'actual');mkdirSync(actual,{mode:0o700});symlinkSync(actual,join(parent,'alias'));
  assert.throws(()=>createPrivateEvidenceDirectory(join(parent,'alias','fresh')),/physical evidence parent/);
  chmodSync(actual,0o777);assert.throws(()=>createPrivateEvidenceDirectory(join(actual,'fresh')),/sticky protection/);
  assert.throws(()=>createPrivateEvidenceDirectory('relative-output'),/absolute evidence path/);
 }finally{rmSync(parent,{recursive:true,force:true});}
});
