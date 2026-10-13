import {act,renderHook,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {type WhiteboardObject} from '@repo/whiteboard-core';
import {useBoardConnectorGesture} from '@/components/whiteboard/use-board-connector-gesture';
afterEach(cleanup);
const node=(id:string,x:number):WhiteboardObject=>({id,schemaVersion:1,kind:'sticky',geometry:{x,y:0,width:100,height:80,rotation:0},text:'',style:{},parentId:null,orderKey:id});
it.each(['accepted','bypass','locked','deleted','readonly','cancel'] as const)('free creation live endpoint snap: %s',mode=>{
 let live=[node('a',0),node('b',300)];const execute=vi.fn(()=>true),created=vi.fn();
 const host=document.createElement('div');host.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:700,bottom:500,width:700,height:500,toJSON(){return {};}});
 const props={objects:live,readLiveObjects:()=>live,viewport:{zoom:1,panX:0,panY:0,fitRequest:0,fitMode:'board' as const},blocked:false,selectedId:null,host:()=>host,execute,onCreated:created,onFailure:vi.fn()};
 const {result,rerender}=renderHook(value=>useBoardConnectorGesture(value),{initialProps:props});
 const event=(x:number,y:number)=>({clientX:x,clientY:y,button:0,pointerId:1,metaKey:false,ctrlKey:mode==='bypass',currentTarget:host,target:host,preventDefault(){},stopPropagation(){}});
 act(()=>result.current.beginFreeCreation('free',event(100,40)));
 act(()=>result.current.beginFreeCreation('free',event(180,100)));
 act(()=>result.current.beginFreeCreation('free',event(300,40)));
 if(mode==='cancel')act(()=>result.current.cancel());
 if(mode==='readonly')rerender({...props,blocked:true});
 act(()=>{if(mode==='locked')live=[live[0]!,{...live[1]!,locked:true}];if(mode==='deleted')live=[live[0]!];result.current.finishFree();});
 if(['locked','deleted','readonly','cancel'].includes(mode)){expect(execute).not.toHaveBeenCalled();expect(created).not.toHaveBeenCalled();}
 else{
  expect(execute).toHaveBeenCalledOnce();const [command,preconditions]=execute.mock.calls[0]! as unknown as [any,any];
  expect(command).toMatchObject({type:'create-connector',relationship:{type:'free',route:{kind:'free',waypoints:[{x:180,y:100}]}}});
  if(mode==='bypass'){expect(command.relationship).toMatchObject({fromPoint:{x:100,y:40},toPoint:{x:300,y:40}});expect(command.relationship.from).toBeUndefined();expect(command.relationship.to).toBeUndefined();expect(preconditions).toEqual([]);}
  else{expect(command.relationship).toMatchObject({from:'a',to:'b',fromAnchor:'right',toAnchor:'left'});expect(command.relationship.fromPoint).toBeUndefined();expect(command.relationship.toPoint).toBeUndefined();expect(preconditions).toEqual([{id:'a',locked:false},{id:'b',locked:false}]);}
 }
 expect(result.current.active).toBe(false);
});
