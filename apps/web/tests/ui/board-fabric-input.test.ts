import {describe,it,expect} from 'vitest';
import {readFabricInput,panFabricViewport} from '@/components/whiteboard/fabric/fabric-input';
const touch=(identifier:number,clientX:number,clientY:number,force?:number)=>({identifier,clientX,clientY,force});
describe('Fabric default MouseEvent/TouchEvent input boundary',()=>{
 it('reproduces raw touch cast NaN and pans with the real primary contact',()=>{
  const down={type:'touchstart',touches:[touch(7,100,120)]},move={type:'touchmove',touches:[touch(7,145,153)]};
  expect(Number.isNaN(Number((move as {clientX?:number}).clientX)-Number((down as {clientX?:number}).clientX))).toBe(true);
  const first=readFabricInput(down)!;expect(panFabricViewport([2,0,0,2,10,20],first,readFabricInput(move,first.id)!)).toEqual([2,0,0,2,55,53]);
 });
 it('tracks one contact through reorder and releases only its changed touch',()=>{const active='touch:7';expect(readFabricInput({type:'touchmove',touches:[touch(8,900,900),touch(7,5,6)]},active)?.x).toBe(5);expect(readFabricInput({type:'touchend',touches:[touch(7,5,6)],changedTouches:[touch(8,9,9)]},active)).toBeNull();expect(readFabricInput({type:'touchend',touches:[],changedTouches:[touch(7,5,6)]},active)?.id).toBe(active);expect(readFabricInput({type:'touchstart',touches:[touch(7,1,2),touch(8,3,4)]})).toBeNull();});
 it('preserves pen and touch pressure, ignores nonprimary pointers and invalid coordinates',()=>{expect(readFabricInput({pointerId:1,pointerType:'pen',clientX:3,clientY:4,pressure:.8})?.pressure).toBe(.8);expect(readFabricInput({touches:[touch(2,3,4,.7)]})?.pressure).toBe(.7);expect(readFabricInput({clientX:1,clientY:2})?.pressure).toBe(.5);expect(readFabricInput({clientX:1,clientY:2,isPrimary:false})).toBeNull();expect(readFabricInput({clientX:NaN,clientY:2})).toBeNull();expect(readFabricInput({clientX:1,clientY:2,pressure:Infinity})?.pressure).toBe(.5);});
 it('never returns a nonfinite viewport and recognizes cancelled primary touch',()=>{const first=readFabricInput({clientX:1,clientY:2})!;expect(panFabricViewport([1,0,0,1,NaN,0],first,first)).toBeNull();expect(readFabricInput({type:'touchcancel',changedTouches:[touch(7,1,2)]},'touch:7')?.id).toBe('touch:7');});
});
