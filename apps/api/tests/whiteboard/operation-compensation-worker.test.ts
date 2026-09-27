import {describe,it,expect} from 'vitest';
import * as Y from 'yjs';
import {createWhiteboardDocument,executeCommands,readObjects,compensateWhiteboardSnapshot} from '@repo/whiteboard-core';
import type {WhiteboardObject} from '@repo/contracts/whiteboard-document';
import {WorkerWhiteboardUpdateValidator} from '../../src/infrastructure/whiteboard/update-validator';
const note=(id:string):WhiteboardObject=>({id,schemaVersion:1,kind:'sticky',text:'original',style:{},parentId:null,orderKey:'',geometry:{x:0,y:0,width:100,height:100,rotation:0}});
describe('trusted operation snapshot compensation',()=>{
 it('restores combined structural and text changes with original IDs and shared field identities',async()=>{
  const doc=createWhiteboardDocument();
  executeCommands(doc,[{type:'create',object:note('a')},{type:'create',object:note('b')},{type:'create',object:{...note('edge'),kind:'connector',connector:{from:'a',to:'b'}}}],{});
  const expected=readObjects(doc),before=Y.encodeStateAsUpdate(doc),value=doc.getMap<Y.Map<unknown>>('objects').get('a')!,text=value.get('text'),style=value.get('style');
  executeCommands(doc,[{type:'delete',id:'b'},{type:'text',id:'a',index:0,deleteCount:8,insert:'changed'},{type:'create',object:note('new')}],{});
  (style as Y.Map<unknown>).set('fill','#ff0000');
  const changed=Y.encodeStateAsUpdate(doc);
  compensateWhiteboardSnapshot(doc,expected);
  expect(readObjects(doc)).toEqual(expected);expect(value.get('text')).toBe(text);expect(value.get('style')).toBe(style);
  const validator=new WorkerWhiteboardUpdateValidator();
  const restored=await validator.compensate(changed,before);
  expect(await validator.objects(restored.snapshot)).toEqual(expected);
  await expect(validator.validate(changed,restored.update)).rejects.toMatchObject({code:'VALIDATION_FAILED'});
  doc.destroy();
 });
 it('compensates panel parenting, layout, style and lock state as one server operation',async()=>{
  const validator=new WorkerWhiteboardUpdateValidator();
  const initial=await validator.commands(new Uint8Array([0,0]),[{type:'create',object:{...note('p'),kind:'frame'}},{type:'create',object:note('child')}]);
  const expected=await validator.objects(initial.snapshot);
  const changed=await validator.commands(initial.snapshot,[{type:'parent',id:'child',parentId:'p',orderKey:'1'},{type:'geometry',id:'child',geometry:{...note('child').geometry,x:40,y:70}},{type:'style',id:'child',style:{fill:'#ffffff'}},{type:'state',id:'child',locked:true}]);
  const restored=await validator.compensate(changed.snapshot,initial.snapshot);expect(await validator.objects(restored.snapshot)).toEqual(expected);
 });
 it('rejects a before-image containing identity absent from the authoritative document',async()=>{
  const original=createWhiteboardDocument();executeCommands(original,[{type:'create',object:note('foreign')}],{});
  await expect(new WorkerWhiteboardUpdateValidator().compensate(new Uint8Array([0,0]),Y.encodeStateAsUpdate(original))).rejects.toMatchObject({code:'VALIDATION_FAILED'});
  original.destroy();
 });
});
