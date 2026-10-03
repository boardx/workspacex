import assert from 'node:assert/strict';
import test from 'node:test';
import {settleStickyRoute,createOwnedStickyRoutes} from './wsx-r06-route-handler.mjs';

const scheduler={run:fn=>fn()};
test('route abort rejection is captured rather than escaping the owned callback',async()=>{
 const failures=[];let aborts=0;
 await settleStickyRoute({scheduler,record:value=>failures.push(value),route:{fetch:async()=>{throw Error('fetch failed');},abort:async()=>{aborts++;throw Error('already closed');}}});
 assert.equal(aborts,1);assert.deepEqual(failures.map(value=>value.code),['ROUTE_FAILURE','ROUTE_ABORT_FAILURE']);
});
test('owned drain waits for admitted handlers before allowing the actor to close',async()=>{
 let handler,release,settled=false;const failures=[];
 let pending;
 const routes=createOwnedStickyRoutes({context:{route:async(_,value)=>{handler=value;},unrouteAll:async options=>{assert.deepEqual(options,{behavior:'wait'});await pending;}},exclusiveContext:true,matcher:/api/,scheduler,record:value=>failures.push(value)});
 await routes.install();const task=pending=handler({fetch:()=>new Promise(resolve=>{release=resolve;}),fulfill:async()=>{settled=true;}});
 const drain=routes.drain();await Promise.resolve();assert.equal(settled,false);
 release({status:()=>200});await task;await drain;assert.equal(settled,true);assert.deepEqual(failures,[]);
});
test('late admission and a real drain timeout remain failures',async()=>{
 let handler;const failures=[];
 let pending;
 const routes=createOwnedStickyRoutes({context:{route:async(_,value)=>{handler=value;},unrouteAll:async()=>{await pending;}},exclusiveContext:true,matcher:/api/,scheduler,deadlineMs:5,record:value=>failures.push(value)});
 await routes.install();let release;const task=pending=handler({fetch:()=>new Promise(resolve=>{release=resolve;}),fulfill:async()=>{}});
 await assert.rejects(routes.drain(),/DRAIN_TIMEOUT/);
 await handler({fetch:async()=>({status:()=>200}),fulfill:async()=>{}});
 release({status:()=>200});await task;
 assert.deepEqual(failures.map(value=>value.code),['ROUTE_DRAIN_FAILURE','LATE_ROUTE_ADMISSION']);
});
test('official all-route wait cannot be used on an unowned shared context',()=>{
 assert.throws(()=>createOwnedStickyRoutes({context:{},matcher:/api/,scheduler,record:()=>{}}),/EXCLUSIVE_CONTEXT_REQUIRED/);
});
test('scheduler rejection still attempts and settles the route abort',async()=>{
 const failures=[];let aborts=0;
 await settleStickyRoute({scheduler:{run:async()=>{throw Error('scheduler failed');}},record:value=>failures.push(value),route:{abort:async()=>{aborts++;}}});
 assert.equal(aborts,1);assert.deepEqual(failures.map(value=>value.code),['ROUTE_FAILURE']);
});
test('HTTP failure remains a hard recorded failure even when response fulfillment succeeds',async()=>{
 const failures=[];let fulfilled=0;
 await settleStickyRoute({scheduler,record:value=>failures.push(value),route:{fetch:async()=>({status:()=>429}),fulfill:async()=>{fulfilled++;}}});
 assert.equal(fulfilled,1);assert.deepEqual(failures,[{code:'HTTP_FAILURE',status:429}]);
});
