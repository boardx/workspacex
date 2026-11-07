import {act,renderHook} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import * as Y from "yjs";
import {createWhiteboardDocument,executeCommands,readObjects,SpatialRelationshipCommandPort,WhiteboardUndo,WhiteboardCommandOrigin,type SpatialCommand,type SpatialPrecondition,type WhiteboardObject} from "@repo/whiteboard-core";
import {connectorGestureSnap} from "@/components/whiteboard/connector-gesture";
import {useBoardConnectorGesture} from "@/components/whiteboard/use-board-connector-gesture";
import type {ConnectorHandleKind,ConnectorOverlayPointerEvent} from "@/components/whiteboard/board-connector-handles";

function setup({free=false}: {free?:boolean}={}) {
  const doc=createWhiteboardDocument();
  const node=(id:string,x:number):WhiteboardObject=>({id,schemaVersion:1,kind:"rectangle",geometry:{x,y:0,width:100,height:80,rotation:0},text:"",style:{},parentId:null,orderKey:id});
  const edge:WhiteboardObject={...node("edge",100),kind:"connector",connector:{from:"a",to:"b",fromAnchor:"right",toAnchor:"left",type:"curve",route:{kind:"curve",startOffset:{x:20,y:30},endOffset:{x:-20,y:-30}},label:"relationship"}};
  if(free){
    // The real body-translate control only exists for two unbound endpoints.
    delete edge.connector!.from;delete edge.connector!.to;
    edge.connector!.fromPoint={x:100,y:40};edge.connector!.toPoint={x:300,y:40};
  }
  executeCommands(doc,[{type:"create",object:node("a",0)},{type:"create",object:node("b",300)},{type:"create",object:node("c",500)},{type:"create",object:edge}],{});
  const undo=new WhiteboardUndo(doc),port=new SpatialRelationshipCommandPort(doc),host=document.createElement("div"),target=document.createElement("button");
  let captured=false,localBatches=0;
  target.setPointerCapture=vi.fn(()=>{captured=true;});target.hasPointerCapture=vi.fn(()=>captured);target.releasePointerCapture=vi.fn(()=>{captured=false;});
  host.getBoundingClientRect=()=>({left:31,top:17,width:900,height:600,right:931,bottom:617,x:31,y:17,toJSON:()=>({})});
  doc.on("afterTransaction",transaction=>{if(transaction.origin instanceof WhiteboardCommandOrigin)localBatches++;});
  const execute=vi.fn((command:SpatialCommand,preconditions?:SpatialPrecondition[])=>{port.dispatch({boardId:"board",clientId:"independent",gestureId:crypto.randomUUID(),command,preconditions});return true;});
  const props={objects:readObjects(doc),readLiveObjects:()=>readObjects(doc),viewport:{zoom:1.65,panX:20,panY:-12,fitRequest:0},blocked:false,selectedId:"edge",host:()=>host,execute,onCreated:vi.fn(),onFailure:vi.fn()};
  const hook=renderHook(value=>useBoardConnectorGesture(value),{initialProps:props});
  const event=(x:number,y:number)=>({pointerId:1,currentTarget:target,button:0,clientX:31+20+x*1.65,clientY:17-12+y*1.65,metaKey:false,ctrlKey:false,preventDefault:vi.fn(),stopPropagation:vi.fn()}) as unknown as ConnectorOverlayPointerEvent;
  return {...hook,doc,undo,props,event,execute,batches:()=>localBatches,destroy:()=>{hook.unmount();undo.destroy();doc.destroy();}};
}
const gestures:Array<[ConnectorHandleKind,string|null,{x:number;y:number},{x:number;y:number}]>=[
  ["route","curve-start",{x:120,y:70},{x:150,y:110}],
  ["label",null,{x:200,y:40},{x:180,y:80}],
  ["to",null,{x:300,y:40},{x:500,y:40}],
  ["translate",null,{x:200,y:40},{x:220,y:60}],
];
it.each(gestures)("%s preview does not write; one release is one real command batch and one Undo",(kind,id,start,end)=>{
  const test=setup({free:kind==='translate'}),before=readObjects(test.doc),bytes=Y.encodeStateAsUpdate(test.doc);
  try {
    act(()=>test.result.current.onPointerDown(kind,id,test.event(start.x,start.y)));
    act(()=>test.result.current.onPointerMove(test.event(end.x,end.y)));
    expect(test.result.current.active).toBe(true);expect(test.execute).not.toHaveBeenCalled();expect(test.batches()).toBe(0);
    expect(Y.encodeStateAsUpdate(test.doc)).toEqual(bytes);
    act(()=>test.result.current.onPointerUp(test.event(end.x,end.y)));act(()=>test.result.current.onPointerUp(test.event(end.x,end.y)));
    expect(test.execute).toHaveBeenCalledTimes(1);expect(test.batches()).toBe(1);
    const dispatched=test.execute.mock.calls[0]![0];
    if(kind==='to')expect(dispatched).toMatchObject({endpointChanges:['to']});
    else if(kind==='translate')expect(dispatched).toMatchObject({endpointChanges:['from','to']});
    else expect(dispatched).not.toHaveProperty('endpointChanges');
    const after=readObjects(test.doc);expect(after).not.toEqual(before);
    expect(test.undo.undo()).toBe("undone");expect(readObjects(test.doc)).toEqual(before);
    expect(test.undo.redo()).toBe(true);expect(readObjects(test.doc)).toEqual(after);
  } finally {test.destroy();}
});
it.each(["edge-locked","target-locked","target-deleted","remote-edge"])("rejects %s committed directly to Yjs before React rerenders",change=>{
  const test=setup();
  try {
    act(()=>test.result.current.onPointerDown("route","curve-start",test.event(120,70)));
    act(()=>test.result.current.onPointerMove(test.event(150,110)));
    if(change==="edge-locked"||change==="target-locked")executeCommands(test.doc,[{type:"state",id:change==="edge-locked"?"edge":"a",locked:true}],{});
    if(change==="target-deleted")executeCommands(test.doc,[{type:"delete",id:"a"}],{});
    if(change==="remote-edge")executeCommands(test.doc,[{type:"connector",id:"edge",connector:{...test.props.objects.find(value=>value.id==="edge")!.connector!,label:"remote label"}}],{});
    const latest=Y.encodeStateAsUpdate(test.doc);
    act(()=>test.result.current.onPointerUp(test.event(150,110)));
    expect(test.execute).not.toHaveBeenCalled();expect(test.batches()).toBe(0);
    expect(Y.encodeStateAsUpdate(test.doc)).toEqual(latest);
  } finally {test.destroy();}
});
it.each(gestures)("%s cancellation rejects late release without canonical mutation",(kind,id,start,end)=>{
  const test=setup({free:kind==='translate'}),bytes=Y.encodeStateAsUpdate(test.doc);
  try {
    act(()=>test.result.current.onPointerDown(kind,id,test.event(start.x,start.y)));act(()=>test.result.current.onPointerMove(test.event(end.x,end.y)));
    act(()=>test.result.current.onPointerCancel());act(()=>test.result.current.onPointerUp(test.event(end.x,end.y)));
    expect(test.execute).not.toHaveBeenCalled();expect(Y.encodeStateAsUpdate(test.doc)).toEqual(bytes);expect(test.result.current.active).toBe(false);
  } finally {test.destroy();}
});
it.each(["blocked","edge-locked","target-locked","target-deleted","remote-edge"])("cancels on %s without replacing the latest canonical state",change=>{
  const test=setup();
  try {
    act(()=>test.result.current.onPointerDown("route","curve-start",test.event(120,70)));act(()=>test.result.current.onPointerMove(test.event(150,110)));
    let objects=test.props.objects,blocked=false;
    if(change==="blocked")blocked=true;
    if(change==="edge-locked"||change==="target-locked")executeCommands(test.doc,[{type:"state",id:change==="edge-locked"?"edge":"a",locked:true}],{});
    if(change==="target-deleted")executeCommands(test.doc,[{type:"delete",id:"a"}],{});
    if(change==="remote-edge")executeCommands(test.doc,[{type:"connector",id:"edge",connector:{...objects.find(value=>value.id==="edge")!.connector!,label:"remote label"}}],{});
    objects=readObjects(test.doc);const latest=Y.encodeStateAsUpdate(test.doc);
    test.rerender({...test.props,objects,blocked});act(()=>test.result.current.onPointerUp(test.event(150,110)));
    expect(test.execute).not.toHaveBeenCalled();expect(test.result.current.active).toBe(false);expect(Y.encodeStateAsUpdate(test.doc)).toEqual(latest);
  } finally {test.destroy();}
});

it.each(['from','to'] as const)('held %s release preserves a remote opposite endpoint before React observes it',side=>{
 for(const rerender of [false,true]){
  const test=setup();
  try{
   const opposite=side==='from'?'to':'from',start=side==='from'?{x:100,y:40}:{x:300,y:40},end=side==='from'?{x:200,y:180}:{x:500,y:40};
   act(()=>test.result.current.onPointerDown(side,null,test.event(start.x,start.y)));
   act(()=>test.result.current.onPointerMove(test.event(end.x,end.y)));
   const remote={...readObjects(test.doc).find(object=>object.id==='edge')!.connector!};
   if(opposite==='to'){delete remote.to;delete remote.toOffset;remote.toPoint={x:800,y:300};remote.toAnchor='bottom';}
   else{delete remote.from;delete remote.fromOffset;remote.fromPoint={x:900,y:400};remote.fromAnchor='top';}
   act(()=>executeCommands(test.doc,[{type:'connector',id:'edge',connector:remote}],{}));
   if(rerender)test.rerender({...test.props,objects:readObjects(test.doc)});
   const beforeRelease=readObjects(test.doc);
   act(()=>test.result.current.onPointerUp(test.event(end.x,end.y)));
   expect(test.execute).toHaveBeenCalledTimes(1);expect(test.batches()).toBe(1);
   expect(test.execute.mock.calls[0]![0]).toMatchObject({type:'update-connector',endpointChanges:[side]});
   const connector=readObjects(test.doc).find(object=>object.id==='edge')!.connector!;
   expect(connector.label).toBe(remote.label);expect(connector.route).toEqual(remote.route);
   if(opposite==='to'){expect(connector.to).toBeUndefined();expect(connector.toPoint).toEqual(remote.toPoint);expect(connector.toAnchor).toBe(remote.toAnchor);expect(connector.fromPoint).toEqual(end);}
   else{expect(connector.from).toBeUndefined();expect(connector.fromPoint).toEqual(remote.fromPoint);expect(connector.fromAnchor).toBe(remote.fromAnchor);expect(connector.to).toBe('c');}
   expect(test.undo.undo()).toBe('undone');expect(readObjects(test.doc)).toEqual(beforeRelease);
  }finally{test.destroy();}
 }
});

it.each(['from','to'] as const)('held %s still cancels when the remote peer changes that same endpoint',side=>{
 const test=setup();
 try{
  const start=side==='from'?{x:100,y:40}:{x:300,y:40},end={x:200,y:180};
  act(()=>test.result.current.onPointerDown(side,null,test.event(start.x,start.y)));
  act(()=>test.result.current.onPointerMove(test.event(end.x,end.y)));
  const remote={...readObjects(test.doc).find(object=>object.id==='edge')!.connector!};
  if(side==='from'){delete remote.from;remote.fromPoint={x:900,y:400};}else{delete remote.to;remote.toPoint={x:800,y:300};}
  act(()=>executeCommands(test.doc,[{type:'connector',id:'edge',connector:remote}],{}));
  const latest=Y.encodeStateAsUpdate(test.doc);
  act(()=>test.result.current.onPointerUp(test.event(end.x,end.y)));
  expect(test.execute).not.toHaveBeenCalled();expect(test.batches()).toBe(0);expect(Y.encodeStateAsUpdate(test.doc)).toEqual(latest);
 }finally{test.destroy();}
});

// The final pointerup may jump beyond the last rendered snap cue. A peer
// invalidating that old cue must not veto a different, valid release target.
it.each(['locked','deleted'] as const)('release-only retarget ignores obsolete %s snap, but rejects staying on it',change=>{
 for(const rerender of [false,true])for(const leave of [false,true]){
  const test=setup();
  try{
   const destination:WhiteboardObject={id:'d',schemaVersion:1,kind:'sticky',geometry:{x:700,y:200,width:100,height:80,rotation:0},text:'D',style:{},parentId:null,orderKey:'d'};
   executeCommands(test.doc,[{type:'create',object:destination}],{});
   test.rerender({...test.props,objects:readObjects(test.doc)});
   act(()=>test.result.current.onPointerDown('to',null,test.event(300,40)));
   act(()=>test.result.current.onPointerMove(test.event(500,40)));
   expect(test.result.current.relationship?.to).toBe('c');
   executeCommands(test.doc,[change==='locked'?{type:'state',id:'c',locked:true}:{type:'delete',id:'c'}],{});
   if(rerender)test.rerender({...test.props,objects:readObjects(test.doc)});
   const latest=readObjects(test.doc);
   act(()=>test.result.current.onPointerUp(test.event(leave?700:500,leave?240:40)));
   act(()=>test.result.current.onPointerUp(test.event(700,240)));
   expect(test.result.current.active).toBe(false);
   expect(test.execute).toHaveBeenCalledTimes(leave?1:0);
   expect(test.batches()).toBe(leave?1:0);
   if(leave){
    expect(readObjects(test.doc).find(object=>object.id==='edge')!.connector).toMatchObject({from:'a',to:'d',toAnchor:'left'});
    expect(test.undo.undo()).toBe('undone');expect(readObjects(test.doc)).toEqual(latest);
   }else expect(readObjects(test.doc)).toEqual(latest);
  }finally{test.destroy();}
 }
});

it.each(['false','throw'] as const)('rejected release (%s) clears preview and leaves canonical intact',rejection=>{
 const test=setup();
 try{
  act(()=>test.result.current.onPointerDown('to',null,test.event(300,40)));
  act(()=>test.result.current.onPointerMove(test.event(500,40)));
  const latest=readObjects(test.doc);
  test.execute.mockImplementationOnce(()=>{if(rejection==='throw')throw new Error('SPATIAL_COMMAND_REJECTED');return false;});
  act(()=>test.result.current.onPointerUp(test.event(500,40)));
  act(()=>test.result.current.onPointerUp(test.event(500,40)));
  expect(test.execute).toHaveBeenCalledOnce();expect(test.props.onFailure).toHaveBeenCalledOnce();
  expect(test.result.current.active).toBe(false);expect(test.result.current.relationship).toBeNull();
  expect(test.batches()).toBe(0);expect(readObjects(test.doc)).toEqual(latest);
 }finally{test.destroy();}
});

it.each(['locked','deleted'] as const)('live overlapping target wins over the obsolete %s cue geometry',change=>{
 for(const rerender of [false,true]){
  const test=setup();
  try{
   act(()=>test.result.current.onPointerDown('to',null,test.event(300,40)));
   act(()=>test.result.current.onPointerMove(test.event(500,40)));
   expect(test.result.current.relationship?.to).toBe('c');
   const oldCue=readObjects(test.doc).find(object=>object.id==='c')!;
   // D arrives under the final pointer. Its valid left anchor is 4 world px
   // away, whereas revoked C's historical anchor is exactly under the pointer.
   const destination:WhiteboardObject={...oldCue,id:'d',orderKey:'d',geometry:{...oldCue.geometry,x:496}};
   executeCommands(test.doc,[change==='locked'?{type:'state',id:'c',locked:true}:{type:'delete',id:'c'},{type:'create',object:destination}],{});
   const live=readObjects(test.doc);
   expect(connectorGestureSnap(live,{x:500,y:40},1.65,['edge','a'],false)?.objectId).toBe('d');
   expect(connectorGestureSnap([...live.filter(object=>object.id!=='c'),oldCue],{x:500,y:40},1.65,['edge','a'],false)?.objectId).toBe('c');
   if(rerender)test.rerender({...test.props,objects:live});
   act(()=>test.result.current.onPointerUp(test.event(500,40)));
   act(()=>test.result.current.onPointerUp(test.event(500,40)));
   expect(test.execute).toHaveBeenCalledOnce();expect(test.batches()).toBe(1);
   const edge=readObjects(test.doc).find(object=>object.id==='edge')!;
   expect(edge.connector).toMatchObject({from:'a',to:'d',toAnchor:'left'});
   expect(edge.connector).not.toHaveProperty('toPoint');
   expect(test.result.current.active).toBe(false);expect(test.props.onFailure).not.toHaveBeenCalled();
   expect(test.undo.undo()).toBe('undone');expect(readObjects(test.doc)).toEqual(live);
  }finally{test.destroy();}
 }
});
