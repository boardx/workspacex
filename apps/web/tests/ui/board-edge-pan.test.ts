import { expect, it, vi } from 'vitest';
import { boardEdgePanVelocity, createBoardEdgePan } from '@/components/whiteboard/fabric/board-edge-pan';
const bounds={left:0,top:0,width:400,height:300};
it('pans inward at all four edges, accelerates toward boundaries and leaves center idle',()=>{
 expect(boardEdgePanVelocity({x:0,y:150},bounds)).toEqual({x:600,y:0});
 expect(boardEdgePanVelocity({x:400,y:150},bounds)).toEqual({x:-600,y:0});
 expect(boardEdgePanVelocity({x:200,y:0},bounds)).toEqual({x:0,y:600});
 expect(boardEdgePanVelocity({x:200,y:300},bounds)).toEqual({x:0,y:-600});
 expect(boardEdgePanVelocity({x:200,y:150},bounds)).toEqual({x:0,y:0});
 expect(boardEdgePanVelocity({x:32,y:150},bounds).x).toBe(150);
 expect(boardEdgePanVelocity({x:0,y:0},{...bounds,width:0})).toEqual({x:0,y:0});
});
it('owns one frame, caps delayed ticks and stops on release, center, readonly and disposal',()=>{
 let next=0,active=true;const frames=new Map<number,FrameRequestCallback>();
 const request=vi.fn((callback:FrameRequestCallback)=>{frames.set(++next,callback);return next;});
 const cancel=vi.fn((id:number)=>{frames.delete(id);}),pan=vi.fn();
 const controller=createBoardEdgePan({bounds:()=>bounds,active:()=>active,pan,request,cancel});
 const step=(time:number)=>{const [id,callback]=[...frames][0]!;frames.delete(id);callback(time);};
 controller.update({x:0,y:150});controller.update({x:0,y:150});expect(frames.size).toBe(1);
 step(0);step(1000);expect(pan).toHaveBeenLastCalledWith({x:30,y:0});
 controller.update({x:200,y:150});expect(frames.size).toBe(0);
 controller.update({x:400,y:150});controller.stop();expect(frames.size).toBe(0);
 controller.update({x:0,y:150});active=false;step(1016);expect(frames.size).toBe(0);
 active=true;controller.update({x:0,y:150});controller.dispose();expect(frames.size).toBe(0);
 controller.update({x:0,y:150});expect(frames.size).toBe(0);
});
it('does not reschedule when the pan callback cancels its session',()=>{
 let frame:FrameRequestCallback|undefined,time=0;let controller:ReturnType<typeof createBoardEdgePan>;
 controller=createBoardEdgePan({bounds:()=>bounds,active:()=>true,request:callback=>{frame=callback;return ++time;},cancel:()=>{frame=undefined;},pan:()=>controller.stop()});
 controller.update({x:0,y:150});frame!(0);const nextFrame=frame!;frame=undefined;nextFrame(16);expect(frame).toBeUndefined();
});
