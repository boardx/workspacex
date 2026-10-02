import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {deniedConnectorWrite,cancelledConnectorGesture} from './connector-c06-oracle.mjs';
test('permission proof rejects schema400 server500 and hidden unauthorized head changes',()=>{
 const before={document:{epoch:2,seq:'10',content_hash:'actual'},updates:[{actor_id:'owner',seq:'10'}]};
 deniedConnectorWrite(before,structuredClone(before),403,403);deniedConnectorWrite(before,structuredClone(before),404,404);
 for(const status of [200,400,401,500])assert.throws(()=>deniedConnectorWrite(before,before,status,403));
 assert.throws(()=>deniedConnectorWrite(before,{...before,document:{...before.document,seq:'11'}},403,403));
 assert.throws(()=>deniedConnectorWrite(before,{...before,updates:[...before.updates,{actor_id:'viewer',seq:'11'}]},404,404));
});
test('held cancellation rejects late submission or ACK even if canonical appears unchanged',()=>{
 const before={document:{epoch:1,seq:'2'},updates:[]};cancelledConnectorGesture(before,structuredClone(before),[{direction:'received',type:'presence'}]);
 assert.throws(()=>cancelledConnectorGesture(before,before,[{direction:'sent',type:'update'}]));
 assert.throws(()=>cancelledConnectorGesture(before,before,[{direction:'received',type:'ack'}]));
 assert.throws(()=>cancelledConnectorGesture(before,{...before,updates:[{actor_id:'revoked'}]},[]));
});
