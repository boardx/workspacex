import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';import {randomUUID}from'node:crypto';
import {withCompleteController}from'./controller';
for(const drift of [false,true])test('original factory and HoldStore '+(drift?'reject actual generation replacement':'order real callback boundaries before clear'),async()=>{
 const root='/tmp/wsx-postclear-'+randomUUID().replaceAll('-','');await fs.mkdir(root,{mode:0o700});const calls:string[]=[];
 try{const r=await withCompleteController(root,process.env.CN_POSTCLEAR_PYTHON!,{held:async()=>{},capture:async()=>{calls.push('backup');return'a'.repeat(64);},rehearse:async()=>{calls.push('restore');},migrate:async()=>{calls.push('migrate');},readback:async()=>{calls.push('readback');}},drift);
 assert.equal(r.originalHoldStore,true);assert.equal(r.productionAccepted,false);assert.deepEqual(calls,drift?['backup']:['backup','restore','migrate','readback']);assert.equal(r.finalHold.state,drift?'held':'cleared');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
