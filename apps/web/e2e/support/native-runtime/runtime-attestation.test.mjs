import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {committedRuntimeSourceHashes} from './runtime-attestation.mjs';
const oid='a'.repeat(40),head='b'.repeat(40),path='dir/space\tand\nnewline.bin';
function fixture({type='blob',size=3,body=Buffer.from([0,10,255]),headerSize=size,truncate=false}={}){
 const calls=[];
 const exec=(_command,args,options)=>{
  calls.push({args,options});
  if(args[0]==='ls-tree')return Buffer.from(`100644 ${type} ${oid} ${size}\t${path}\0`);
  return Buffer.concat([Buffer.from(`${oid} ${type} ${headerSize}\n`),body,truncate?Buffer.alloc(0):Buffer.from('\n')]);
 };
 return {exec,calls};
}
test('batches exact HEAD blobs with binary bytes and NUL-safe special paths',()=>{
 const {exec,calls}=fixture();
 assert.deepEqual(committedRuntimeSourceHashes('/candidate',head,[path],{exec}),{[path]:createHash('sha256').update(Buffer.from([0,10,255])).digest('hex')});
 assert.equal(calls.length,2);assert.deepEqual(calls[0].args,['ls-tree','-r','-l','-z',head]);
 assert.equal(calls[1].options.input,oid+'\n');
});
test('rejects absent source, non-blob and mismatched lengths',()=>{
 assert.throws(()=>committedRuntimeSourceHashes('/candidate',head,['absent'],fixture()),/must exist in attested commit/);
 assert.throws(()=>committedRuntimeSourceHashes('/candidate',head,[path],fixture({type:'commit'})),/committed blob/);
 assert.throws(()=>committedRuntimeSourceHashes('/candidate',head,[path],fixture({headerSize:4})),/length mismatch/);
 assert.throws(()=>committedRuntimeSourceHashes('/candidate',head,[path],fixture({truncate:true})),/truncated/);
});
test('rejects a wrong object identity and missing frame terminator',()=>{
 const broken=fixture();const original=broken.exec;
 broken.exec=(command,args,options)=>{const bytes=original(command,args,options);return args[0]==='cat-file'?Buffer.from(bytes.toString('latin1').replace(oid,'c'.repeat(40)),'latin1'):bytes;};
 assert.throws(()=>committedRuntimeSourceHashes('/candidate',head,[path],broken),/identity mismatch/);
 const end=fixture({body:Buffer.from([1,2,3,4])});
 assert.throws(()=>committedRuntimeSourceHashes('/candidate',head,[path],end),/terminator/);
});
