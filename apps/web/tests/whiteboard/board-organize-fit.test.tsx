import {act,renderHook} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {organizeFitBounds,useBoardOrganizeFit,type BoardOrganizeFitRequest} from '@/components/whiteboard/use-board-organize-fit';
import type {WhiteboardObject} from '@repo/whiteboard-core';
const geometry={x:1800,y:1200,width:600,height:400,rotation:0};
const object={id:'panel',geometry} as WhiteboardObject;
const request={id:'local-confirm',proposal:{action:{commands:[{type:'create',object}]}}} as BoardOrganizeFitRequest;
const host={current:{getBoundingClientRect:()=>({width:1280,height:720})} as HTMLDivElement};
afterEach(()=>vi.unstubAllGlobals());
it('waits for actual canonical object and matching geometry, not merely HTTP confirmation',()=>{expect(organizeFitBounds(request,[])).toBeNull();expect(organizeFitBounds(request,[{...object,geometry:{...geometry,x:0}}])).toBeNull();expect(organizeFitBounds(request,[object])).toEqual({left:1800,top:1200,right:2400,bottom:1600});});
it('fits once after Yjs materialization and keeps independent peers unchanged',()=>{vi.stubGlobal('matchMedia',()=>({matches:true}));const local=vi.fn(),peer=vi.fn();const hook=renderHook(({objects})=>{useBoardOrganizeFit(request,objects,host,local);useBoardOrganizeFit(null,objects,host,peer);},{initialProps:{objects:[] as WhiteboardObject[]}});expect(local).not.toHaveBeenCalled();hook.rerender({objects:[object]});expect(local).toHaveBeenCalledOnce();expect(peer).not.toHaveBeenCalled();const next=local.mock.calls[0]![0]({zoom:1,panX:0,panY:0,fitRequest:0});expect(geometry.x*next.zoom+next.panX).toBeGreaterThanOrEqual(32);expect(geometry.y*next.zoom+next.panY).toBeGreaterThanOrEqual(96);expect((geometry.y+geometry.height)*next.zoom+next.panY).toBeLessThanOrEqual(592);hook.rerender({objects:[object,{...object,id:'remote'}]});expect(local).toHaveBeenCalledOnce();});
it('manual browsing cancels a pending fit before delayed canonical data arrives',()=>{vi.stubGlobal('matchMedia',()=>({matches:true}));const set=vi.fn();const hook=renderHook(({objects})=>useBoardOrganizeFit(request,objects,host,set),{initialProps:{objects:[] as WhiteboardObject[]}});act(()=>hook.result.current());hook.rerender({objects:[object]});expect(set).not.toHaveBeenCalled();});
it('smooth fit survives fresh object arrays on viewport renders and stops on manual input',()=>{
  vi.stubGlobal('matchMedia',()=>({matches:false}));
  const frames:Array<FrameRequestCallback>=[],cancel=vi.fn();
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.push(callback);return frames.length;});vi.stubGlobal('cancelAnimationFrame',cancel);
  const set=vi.fn();const hook=renderHook(({objects})=>useBoardOrganizeFit(request,objects,host,set),{initialProps:{objects:[object]}});
  expect(frames).toHaveLength(1);act(()=>frames[0]!(performance.now()+60));hook.rerender({objects:[{...object}]});expect(cancel).not.toHaveBeenCalled();expect(frames).toHaveLength(2);act(()=>hook.result.current());expect(cancel).toHaveBeenCalledWith(2);
});
