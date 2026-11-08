import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WhiteboardObject } from '@repo/whiteboard-core';
import { canonicalSceneBounds } from '@repo/whiteboard-core';
import { artifactFocusBounds, readBoardArtifactFocus, useBoardArtifactFocus } from '@/components/whiteboard/use-board-artifact-focus';
import { fitBoardContent } from '@/components/whiteboard/board-chrome-fit';
import { boardViewportStorageKey, saveBoardViewport, useBoardPersistedViewport } from '@/components/whiteboard/use-board-persisted-viewport';
const request = { artifactId: 'actualart-target', layoutHash: `layout-v1:${'a'.repeat(64)}` };
const insets = { left: 32, right: 32, top: 96, bottom: 128 };
const frame = { width: 1200, height: 800 };
const host = { current: { getBoundingClientRect: () => frame } as HTMLElement };
const object = (id:string,x:number,y:number,width:number,height:number,overrides:Partial<WhiteboardObject>={}) => ({
 id, schemaVersion:1, kind:'shape', geometry:{x,y,width,height,rotation:0}, style:{}, text:'',
 parentId:null,orderKey:id,extensionData:{content:{type:'artifact',...request}}, ...overrides,
} as WhiteboardObject);
const target = [object('first',-2000,-1000,800,200),object('second',-800,-400,400,300)];
let frames:FrameRequestCallback[];
beforeEach(()=>{
 localStorage.clear();frames=[];
 vi.spyOn(window,'requestAnimationFrame').mockImplementation(callback=>{frames.push(callback);return frames.length;});
 vi.spyOn(window,'cancelAnimationFrame').mockImplementation(()=>{});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function flush(){act(()=>{const callbacks=frames.splice(0);callbacks.forEach(callback=>callback(0));});}
it('accepts only one bounded canonical artifact and layout identifier from the URL',()=>{
 const url=new URLSearchParams({focusArtifact:request.artifactId,focusLayout:request.layoutHash,x:'999999'});
 expect(readBoardArtifactFocus(url)).toEqual(request);
 for(const bad of [new URLSearchParams(),new URLSearchParams({focusArtifact:'a',focusLayout:'layout-v1:fake'}),new URLSearchParams({focusArtifact:'a'.repeat(201),focusLayout:request.layoutHash}),new URLSearchParams(`${url}&focusArtifact=other`)])expect(readBoardArtifactFocus(bad)).toBeNull();
});
it('uses only matching visible canonical object bounds, including rotation',()=>{
 const rotated=object('rotated',-20,50,300,100,{geometry:{x:-20,y:50,width:300,height:100,rotation:90}});
 const unrelated=object('foreign',99999,99999,9999,9999,{extensionData:{content:{type:'artifact',...request,artifactId:'another'}}});
 const hidden=object('hidden',-99999,-99999,9999,9999,{hidden:true});
 const {left,top,right,bottom}=canonicalSceneBounds(rotated.geometry);
 expect(artifactFocusBounds(request,[rotated,unrelated,hidden])).toEqual({left,top,right,bottom});
 expect(artifactFocusBounds(request,[unrelated,hidden])).toBeNull();
 expect(artifactFocusBounds(request,[object('wrong-layout',0,0,100,100,{extensionData:{content:{type:'artifact',...request,layoutHash:`layout-v1:${'b'.repeat(64)}`}}})])).toBeNull();
});
it('waits for target objects and fits once without modifying canonical objects or reselecting',()=>{
 const setViewport=vi.fn();const snapshot=JSON.stringify(target);
 const view=renderHook(({objects})=>useBoardArtifactFocus(request,objects,host,setViewport,insets,'board:user',true),{initialProps:{objects:[] as WhiteboardObject[]}});
 flush();expect(setViewport).not.toHaveBeenCalled();
 view.rerender({objects:target});flush();expect(setViewport).toHaveBeenCalledTimes(1);
 const fitted=setViewport.mock.calls[0]![0]({zoom:1,panX:0,panY:0,fitRequest:0});
 expect(fitted).toEqual({fitRequest:0,...fitBoardContent(frame.width,frame.height,{left:-2000,top:-1000,right:-400,bottom:-100},insets)});
 view.rerender({objects:[...target,object('later',9999,9999,100,100)]});flush();expect(setViewport).toHaveBeenCalledTimes(1);
 expect(JSON.stringify(target)).toBe(snapshot);
});
it('does not fit hidden objects or an unready frame',()=>{
 const setViewport=vi.fn();const hidden:WhiteboardObject[]=target.map(value=>({...value,hidden:true}));
 const view=renderHook(({objects,ready})=>useBoardArtifactFocus(request,objects,host,setViewport,insets,'board:user',ready),{initialProps:{objects:hidden,ready:true}});
 flush();expect(setViewport).not.toHaveBeenCalled();
 view.rerender({objects:target,ready:false});flush();expect(setViewport).not.toHaveBeenCalled();
 view.rerender({objects:target,ready:true});flush();expect(setViewport).toHaveBeenCalledTimes(1);
});
it('wins over persisted restoration after late identity, while leaving stored view untouched',()=>{
 const stored={zoom:2,panX:4000,panY:3000,fitRequest:0};
 saveBoardViewport(boardViewportStorageKey('board','user'),stored);
 const view=renderHook(({user}:{user?:string})=>{
  const state=useBoardPersistedViewport('board',user);
  useBoardArtifactFocus(request,target,host,state.setViewport,insets,`board:${user??''}`,Boolean(user));
  return state.viewport;
 },{initialProps:{user:undefined as string|undefined}});
 flush();view.rerender({user:'user'});flush();
 expect(view.result.current).toMatchObject(fitBoardContent(frame.width,frame.height,{left:-2000,top:-1000,right:-400,bottom:-100},insets));
 expect(JSON.parse(localStorage.getItem(boardViewportStorageKey('board','user')!)!)).toMatchObject({zoom:stored.zoom,panX:stored.panX,panY:stored.panY});
});

it('cancels a pending fit on unmount and uses current chrome insets before the first fit',()=>{
 const setViewport=vi.fn();
 const view=renderHook(({padding})=>useBoardArtifactFocus(request,target,host,setViewport,padding,'board:user'),{initialProps:{padding:insets}});
 const measured={...insets,top:148,bottom:180};view.rerender({padding:measured});flush();
 expect(setViewport).toHaveBeenCalledTimes(1);
 expect(setViewport.mock.calls[0]![0]({fitRequest:0})).toMatchObject(fitBoardContent(frame.width,frame.height,{left:-2000,top:-1000,right:-400,bottom:-100},measured));
 view.unmount();
 const canceled=renderHook(()=>useBoardArtifactFocus(request,target,host,setViewport,insets,'board:other'));
 canceled.unmount();flush();expect(setViewport).toHaveBeenCalledTimes(1);
});

it('includes sequence lifeline and return helpers only through matching visible main sources',()=>{
 const main=(id:string,sourceId:string,x:number,y:number)=>object(id,x,y,300,100,{extensionData:{content:{type:'artifact',...request,sourceId}}});
 const helper=(id:string,sourceId:string,x:number,y:number,width:number,height:number,artifactId=request.artifactId)=>object(id,x,y,width,height,{kind:'connector',extensionData:{content:{type:'artifact-helper',artifactId,sourceId}}});
 const mains=[main('participant','participant-source',100,50),main('message','message-source',400,300)];
 const lifeline=helper('lifeline','participant-source',250,150,1,1600);
 const messageReturn=helper('return','message-source',700,600,400,1);
 const objects=[...mains,lifeline,messageReturn,
  helper('foreign-artifact','participant-source',99999,99999,100,100,'another-artifact'),
  helper('foreign-source','not-in-layout',-99999,-99999,100,100),
  {...helper('hidden','participant-source',99999,99999,100,100),hidden:true},
  {...main('hidden-main','hidden-source',0,0),hidden:true},
  helper('hidden-main-helper','hidden-source',99999,99999,100,100),
 ];
 const bounds={left:100,top:50,right:1100,bottom:1750};
 expect(artifactFocusBounds(request,objects)).toEqual(bounds);
 expect(artifactFocusBounds(request,[lifeline,messageReturn])).toBeNull();
 const setViewport=vi.fn();
 renderHook(()=>useBoardArtifactFocus(request,objects,host,setViewport,insets,'sequence:user'));
 flush();expect(setViewport).toHaveBeenCalledTimes(1);
 expect(setViewport.mock.calls[0]![0]({fitRequest:0})).toMatchObject(fitBoardContent(frame.width,frame.height,bounds,insets));
});
