import assert from 'node:assert/strict';
import test from 'node:test';
import {runStickyTwoUserConvergence} from './wsx-r06-two-user-cases.mjs';
const actor=(pid,userId,orgId='org')=>({pid,identity:{userId,orgId}});
test('two tabs or contexts in one browser cannot prove S14',async()=>{
 await assert.rejects(runStickyTwoUserConvergence({},actor(123,'a'),actor(123,'b')),/two contexts/);
});
test('two processes with one account cannot prove independent users',async()=>{
 await assert.rejects(runStickyTwoUserConvergence({},actor(123,'a'),actor(124,'a')),/genuinely authenticated/);
});
test('different organizations cannot act as the intended same-org peer fixture',async()=>{
 await assert.rejects(runStickyTwoUserConvergence({},actor(123,'a','org1'),actor(124,'b','org2')));
});
test('viewer must not be relabelled as the editable peer',async()=>{
 const ctx={state:async actor=>({head:{role:actor.identity.userId==='a'?'owner':'viewer'},objects:[]})};
 await assert.rejects(runStickyTwoUserConvergence(ctx,actor(123,'a'),actor(124,'b')));
});
