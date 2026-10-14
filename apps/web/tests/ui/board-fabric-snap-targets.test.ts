import {describe,expect,it} from 'vitest';
import {calculateSnapGuides} from '@repo/whiteboard-core';
import {snapTargetsForFabricSelection} from '@/components/whiteboard/fabric/fabric-transform';
const geometry=(x:number,y:number,width=60,height=70)=>({x,y,width,height,rotation:0});
describe('Fabric selected movement snap candidates',()=>{
 it('excludes a derived attached edge even when the edge itself is unselected',()=>{
  const selected=[{id:'sticky',geometry:geometry(60,150)},{id:'shape',geometry:geometry(120,175)},{id:'drawing',geometry:geometry(95,210)}];
  // A stale edge bbox can generate the same -4/+3.429 offset independently
  // of pointer rounding. This is a pure candidate-policy counterexample.
  const edge={id:'edge',geometry:geometry(98,199.429,48,10),connector:{from:'sticky',to:'shape'}};
  const moved=geometry(102,196),oldTargets=[edge];
  const stale=calculateSnapGuides(moved,oldTargets,10);
  expect(stale.delta.x).toBeCloseTo(-4,6);expect(stale.delta.y).toBeCloseTo(3.429,6);
  const targets=snapTargetsForFabricSelection([...selected,edge],selected.map(object=>object.id));
  expect(targets).toEqual([]);
  const safe=calculateSnapGuides(moved,targets,10);
  expect(safe.delta).toEqual({x:0,y:0});expect(safe.guides).toEqual([]);
 });
 it('preserves independent objects and edges while excluding container descendants and partially attached edges',()=>{
  const objects=[{id:'group',geometry:geometry(0,0)},{id:'child',parentId:'group',geometry:geometry(10,20)},{id:'nested',parentId:'child',geometry:geometry(30,40)},{id:'outside',geometry:geometry(103,196)},{id:'moving-edge',geometry:geometry(50,50),connector:{from:'nested',to:'outside'}},{id:'static-edge',geometry:geometry(800,900),connector:{from:'outside',to:'other'}}];
  const targets=snapTargetsForFabricSelection(objects,['group']);
  expect(targets.map(object=>object.id)).toEqual(['outside','static-edge']);
  const snapped=calculateSnapGuides(geometry(102,196),targets,10);
  expect(snapped.guides.some(guide=>guide.targetId==='outside')).toBe(true);expect(snapped.delta.x).toBeCloseTo(1,6);
 });
});
