import {expect,it} from 'vitest';
import {spatialFrameMetadata} from '../../e2e/support/board-spatial-ws-metadata';
it('retains only bounded receipt metadata including UUID gesture identity',()=>{
 const updateId='00000000-0000-0000-0000-000000000001',gestureId='00000000-0000-0000-0000-000000000002';
 expect(spatialFrameMetadata(JSON.stringify({type:'ack',seq:7,updateId,gestureId,token:'not-retained',update:'not-retained',url:'not-retained',text:'not-retained'}))).toEqual({type:'ack',updateId,gestureId,seq:7});
});
it('rejects unbounded or nonUUID gesture IDs and never exports error text',()=>{
 for(const gestureId of ['private-value','x'.repeat(4096),'00000000-0000-0000-0000-000000000002/private'])expect(spatialFrameMetadata(JSON.stringify({type:'error',code:'ACK_CONFLICT',gestureId,message:'not-retained'}))).toEqual({type:'error',code:'ACK_CONFLICT'});
});
it('retains positive safe update epochs without inventing ACK epoch fields',()=>{
 expect(spatialFrameMetadata(JSON.stringify({type:'update',epoch:3,token:'not-retained'}))).toEqual({type:'update',epoch:3});
 for(const epoch of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'3',null])expect(spatialFrameMetadata(JSON.stringify({type:'update',epoch}))).toEqual({type:'update'});
 expect(spatialFrameMetadata(JSON.stringify({type:'ack',epoch:3}))).toEqual({type:'ack'});
});
