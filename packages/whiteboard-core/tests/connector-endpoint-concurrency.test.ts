import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { cloneDocument, createWhiteboardDocument, executeCommands, objectMap, readObjects, readStoredObject, validateDocument } from '../src/document';
import { prepareWhiteboardUpdate } from '../src/update';
import { copyObjects } from '../src/document';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';
const edge: WhiteboardObject = {id:'edge',schemaVersion:1,kind:'connector',geometry:{x:10,y:20,width:90,height:80,rotation:0},text:'label',style:{},parentId:null,orderKey:'a',connector:{fromPoint:{x:10,y:20},toPoint:{x:100,y:100},type:'straight',label:'label'}};
const seed=()=>{const doc=createWhiteboardDocument();executeCommands(doc,[{type:'create',object:edge}],{});return doc;};
describe('independent connector endpoint slots',()=>{
 it.each([false,true])('merges held opposite endpoint updates from legacy plain records in either order=%s',reverse=>{
  const base=seed(),a=cloneDocument(base),b=cloneDocument(base),vector=Y.encodeStateVector(base);
  executeCommands(a,[{type:'connector',id:'edge',connector:{...edge.connector!,fromPoint:{x:20,y:30}}}],{});
  executeCommands(b,[{type:'connector',id:'edge',connector:{...edge.connector!,toPoint:{x:180,y:140}}}],{});
  const updates=[Y.encodeStateAsUpdate(a,vector),Y.encodeStateAsUpdate(b,vector)];if(reverse)updates.reverse();
  for(const update of updates)Y.applyUpdate(base,prepareWhiteboardUpdate(base,update));
  expect(readObjects(base)[0]!.connector).toEqual({...edge.connector,fromPoint:{x:20,y:30},toPoint:{x:180,y:140}});
  expect(readObjects(base)[0]!.geometry).toEqual({x:20,y:30,width:160,height:110,rotation:0});
  expect(readStoredObject(base,'edge')).toEqual(readObjects(base)[0]);
  const reloaded=createWhiteboardDocument();Y.applyUpdate(reloaded,Y.encodeStateAsUpdate(base));expect(readObjects(reloaded)).toEqual(readObjects(base));
  expect(copyObjects(base,['edge'],id=>`${id}-copy`)[0]!.connector).toEqual(readObjects(base)[0]!.connector);
  validateDocument(base);for(const doc of [base,a,b,reloaded])doc.destroy();
 });
 it('appearance-only edits do not overwrite a concurrent moved endpoint',()=>{
  const base=seed(),a=cloneDocument(base),b=cloneDocument(base),vector=Y.encodeStateVector(base);
  executeCommands(a,[{type:'connector',id:'edge',connector:{...edge.connector!,fromPoint:{x:50,y:60}}}],{});
  executeCommands(b,[{type:'connector',id:'edge',connector:{...edge.connector!,strokeWidth:12}}],{});
  for(const doc of [a,b])Y.applyUpdate(base,prepareWhiteboardUpdate(base,Y.encodeStateAsUpdate(doc,vector)));
  expect(readObjects(base)[0]!.connector).toMatchObject({fromPoint:{x:50,y:60},strokeWidth:12});for(const doc of [base,a,b])doc.destroy();
 });
 it('rejects malformed endpoint slots and legacy replacement writes once a slot exists',()=>{
  const base=seed();executeCommands(base,[{type:'connector',id:'edge',connector:{...edge.connector!,fromPoint:{x:50,y:60}}}],{});
  for(const malformed of [{fromPoint:{x:Infinity,y:0}},{toPoint:{x:1,y:2}},{fromPoint:{x:1,y:2},unexpected:true}]){
   const bad=cloneDocument(base),vector=Y.encodeStateVector(base);objectMap(bad).get('edge')!.set('connectorFrom',malformed);
   expect(()=>prepareWhiteboardUpdate(base,Y.encodeStateAsUpdate(bad,vector))).toThrow();bad.destroy();
  }
  const legacy=cloneDocument(base),vector=Y.encodeStateVector(base);objectMap(legacy).get('edge')!.set('connector',{...edge.connector!,fromPoint:{x:99,y:99}});
  expect(()=>prepareWhiteboardUpdate(base,Y.encodeStateAsUpdate(legacy,vector))).toThrow('CONNECTOR_LEGACY_ENDPOINT_WRITE');legacy.destroy();base.destroy();
 });
});

it('preserves a received peer endpoint when a held gesture releases with explicit one-end intent', async()=>{
 const { SpatialRelationshipCommandPort } = await import('../src/spatial-relationships');
 const doc=seed(),port=new SpatialRelationshipCommandPort(doc);
 const relationship={...edge.connector!,fromAnchor:'center' as const,toAnchor:'center' as const,type:'straight' as const,startStyle:'none' as const,endStyle:'arrow' as const,lineStyle:'solid' as const,label:'label',semanticRelation:''};
 port.dispatch({boardId:'board',clientId:'peer',gestureId:'peer-to',command:{type:'update-connector',id:'edge',relationship:{...relationship,toPoint:{x:180,y:140}},endpointChanges:['to']}});
 port.dispatch({boardId:'board',clientId:'held',gestureId:'held-from',command:{type:'update-connector',id:'edge',relationship:{...relationship,fromPoint:{x:20,y:30}},endpointChanges:['from']}});
 expect(readObjects(doc)[0]!.connector).toMatchObject({fromPoint:{x:20,y:30},toPoint:{x:180,y:140}});
 expect(readObjects(doc)[0]!.geometry).toEqual({x:20,y:30,width:160,height:110,rotation:0});doc.destroy();
});

it('keeps deletion receipt content stable when a surviving bound endpoint moves',()=>{
 const doc=createWhiteboardDocument();
 const node:WhiteboardObject={id:'node',schemaVersion:1,kind:'sticky',geometry:{x:300,y:100,width:100,height:80,rotation:0},text:'Node',style:{},parentId:null,orderKey:'b'};
 executeCommands(doc,[{type:'create',object:node},{type:'create',object:{...edge,connector:{fromPoint:{x:10,y:20},to:'node',toAnchor:'left'}}}],{});
 executeCommands(doc,[{type:'connector',id:'edge',connector:{fromPoint:{x:20,y:30},to:'node',toAnchor:'left'}}],{});
 executeCommands(doc,[{type:'delete',id:'edge'}],{});
 const retained=readStoredObject(doc,'edge');
 executeCommands(doc,[{type:'geometry',id:'node',geometry:{...node.geometry,x:500}}],{});
 expect(readStoredObject(doc,'edge')).toEqual(retained);
 executeCommands(doc,[{type:'restore',id:'edge'}],{});
 expect(readObjects(doc).find(value=>value.id==='edge')!.connector).toMatchObject({fromPoint:{x:20,y:30},to:'node'});
 expect(readObjects(doc).find(value=>value.id==='edge')!.geometry).toEqual({x:20,y:30,width:480,height:110,rotation:0});doc.destroy();
});
