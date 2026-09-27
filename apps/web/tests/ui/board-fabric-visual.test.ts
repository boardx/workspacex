import {describe,it,expect} from 'vitest';
import {Rect,Shadow} from 'fabric';
import {STICKY_COLOR_PRESETS,type WhiteboardObject} from '@repo/whiteboard-core';
import {BOARD_FABRIC_VISUAL,boardDotGridStyle} from '@/components/whiteboard/fabric/board-fabric-visual';
import {toBoardFabricObjects} from '@/components/whiteboard/whiteboard-fabric-projection';

describe('Board visual presentation',()=>{
 it('uses soft new-note defaults without rewriting explicit persisted colors or typography',()=>{
  const base:WhiteboardObject={id:'note',schemaVersion:1,kind:'sticky',orderKey:'a',parentId:null,text:'中文思考',geometry:{x:0,y:0,width:180,height:180,rotation:0},style:{}};
  const legacy={...base,id:'legacy',style:{fill:'#F8D76E'}};
  const custom={...base,id:'custom',extensionData:{thinkingInput:{sticky:{variant:'square',sizing:'fixed',color:'#123456'},text:{preset:'body',fontFamily:'Microsoft YaHei',fontSize:22}}}};
  const before=JSON.stringify([base,legacy,custom]), projected=toBoardFabricObjects([base,legacy,custom]);
  expect(projected.map(o=>o.style.fill)).toEqual([STICKY_COLOR_PRESETS.yellow,'#F8D76E','#123456']);
  expect(projected[2]!.style.fontFamily).toBe('Microsoft YaHei');expect(JSON.stringify([base,legacy,custom])).toBe(before);
 });
 it('keeps subtle shadows and touch-friendly blue handles outside canonical geometry',()=>{
  const object=new Rect({left:20,top:30,width:180,height:180,strokeWidth:0});const before=object.getBoundingRect();
  object.set({...BOARD_FABRIC_VISUAL.selection,shadow:BOARD_FABRIC_VISUAL.sticky.shadow});
  expect(object.shadow).toBeInstanceOf(Shadow);expect(object.shadow!.blur).toBe(5);expect(object.getBoundingRect()).toEqual(before);
  expect(object.cornerStyle).toBe('circle');expect(object.borderColor).toBe('#2563EB');expect(object.touchCornerSize).toBeGreaterThanOrEqual(44);
 });
 it.each([.05,.2,1,2,8])('keeps zoom %s dots sparse, world-anchored and independent of object count',zoom=>{
  const first=boardDotGridStyle({zoom,panX:0,panY:0}),moved=boardDotGridStyle({zoom,panX:75,panY:-40});
  const spacing=parseFloat(first.backgroundSize);expect(spacing).toBeGreaterThanOrEqual(16);expect(spacing).toBeLessThanOrEqual(48);
  const x=parseFloat(moved.backgroundPosition);expect(x+spacing/2).toBe(75);expect(moved.backgroundSize).toBe(first.backgroundSize);
 });
});
