import {describe,it,expect} from 'vitest';
import {beginBoardPinch,updateBoardPinch} from '../../components/whiteboard/fabric/board-pinch-viewport';
import {clampBoardZoom} from '../../components/whiteboard/fabric/board-fabric-object';
const points=(x=100,y=100,d=100)=>[{pointerId:1,x,y},{pointerId:2,x:x+d,y}];
const viewport={zoom:2,panX:50,panY:30};
describe('two-finger canvas-space viewport',()=>{
 it('scales distance and preserves world anchor while moving midpoint',()=>{
  const session=beginBoardPinch(points(),viewport)!;
  const next=updateBoardPinch(session,points(120,150,200))!.viewport;
  expect(next).toEqual({zoom:4,panX:20,panY:10});
  expect((220-next.panX)/next.zoom).toBe(session.worldAnchor.x);
  expect((150-next.panY)/next.zoom).toBe(session.worldAnchor.y);
 });
 it('uses initial distance, not accumulated event ratios; pointer order is irrelevant',()=>{
  const session=beginBoardPinch(points(),viewport)!;
  updateBoardPinch(session,points(100,100,120));
  expect(updateBoardPinch(session,points(100,100,150).reverse())).toEqual(updateBoardPinch(session,points(100,100,150)));
  expect(updateBoardPinch(session,points(100,100,150))!.viewport.zoom).toBe(3);
 });
 it('reuses canonical min/max zoom and keeps anchor at both bounds',()=>{
  const session=beginBoardPinch(points(),viewport)!;
  for(const distance of [.001,100000]){
   const next=updateBoardPinch(session,points(100,100,distance))!.viewport;
   expect(next.zoom).toBe(clampBoardZoom(2*distance/100));
   expect((100+distance/2-next.panX)/next.zoom).toBeCloseTo(session.worldAnchor.x,7);
  }
 });
 it('terminates replacement, cancellation, third-finger and zero-distance sessions',()=>{
  const session=beginBoardPinch(points(),viewport)!;
  for(const invalid of [[],points().slice(0,1),[...points(),{pointerId:3,x:3,y:3}],points(0,0,0),points().map(p=>({...p,pointerId:p.pointerId+1}))])expect(updateBoardPinch(session,invalid)).toBeNull();
  expect(updateBoardPinch(session,points(),true)).toBeNull();
  expect(updateBoardPinch(null,points())).toBeNull();
 });
 it('rejects nonfinite coordinates, viewport and overflow without emitting a transform',()=>{
  for(const value of [NaN,Infinity,-Infinity]){
   expect(beginBoardPinch(points(value),viewport)).toBeNull();
   expect(beginBoardPinch(points(),{...viewport,panX:value})).toBeNull();
   expect(updateBoardPinch(beginBoardPinch(points(),viewport),points(value))).toBeNull();
  }
  expect(beginBoardPinch(points(),{...viewport,zoom:0})).toBeNull();
  expect(beginBoardPinch(points().map(p=>({...p,pointerId:1})),viewport)).toBeNull();
 });
});
