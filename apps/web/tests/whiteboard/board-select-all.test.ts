import {expect,it} from 'vitest';
import type {WhiteboardObject} from '@repo/contracts/whiteboard-document';
import {boardSelectAllIds} from '../../components/whiteboard/board-select-all';
import {toBoardFabricObjects} from '../../components/whiteboard/whiteboard-fabric-projection';
const object=(id:string,extra:Partial<WhiteboardObject>={}):WhiteboardObject=>({id,schemaVersion:1,kind:'sticky',geometry:{x:0,y:0,width:100,height:100,rotation:0},text:'',style:{},parentId:null,orderKey:id,locked:false,hidden:false,zIndex:0,...extra});
it('selects visible containment roots once, preserves locked inspection, and excludes hidden ancestry/placeholders',()=>{
 const objects=[object('group',{kind:'group'}),object('child',{parentId:'group'}),object('grandchild',{parentId:'child'}),object('hidden',{hidden:true}),object('hidden-child',{parentId:'hidden'}),object('locked',{locked:true}),object('loose'),object('unknown',{kind:'future' as WhiteboardObject['kind']})];
 expect(boardSelectAllIds(objects,toBoardFabricObjects(objects))).toEqual(['group','locked','loose']);
});
it('uses current projection and stays safe on malformed ancestry',()=>{
 const objects=[object('a',{parentId:'b'}),object('b',{parentId:'a'}),object('c')];
 expect(boardSelectAllIds(objects,toBoardFabricObjects(objects))).toEqual(['c']);
 expect(boardSelectAllIds(objects,[])).toEqual([]);
});
