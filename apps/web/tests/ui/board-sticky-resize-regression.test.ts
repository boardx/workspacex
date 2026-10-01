import {describe,it,expect} from 'vitest';
import {Rect} from 'fabric';
import {geometryFromFabric} from '@/components/whiteboard/fabric/board-fabric-surface';
import {toBoardFabricObjects} from '@/components/whiteboard/whiteboard-fabric-projection';
import type {WhiteboardObject} from '@repo/whiteboard-core';
const canonical=(variant:'square'|'circle'|'rectangle',sizing:'auto-height'|'auto-size'|'fixed')=>toBoardFabricObjects([{id:'sticky',schemaVersion:1,kind:'sticky',geometry:{x:20,y:30,width:180,height:180,rotation:0},text:'Idea',style:{},parentId:null,orderKey:'a',extensionData:{thinkingInput:{sticky:{variant,sizing,color:'#C6DDFF'}}}} satisfies WhiteboardObject])[0]!;
describe('real Fabric sticky corner geometry',()=>{
 for(const variant of ['square','circle'] as const)for(const scale of [.5,2])it(`${variant} auto-height accepts ${scale} corner scaling without rebound or anchor drift`,()=>{
  // A top-left corner gesture keeps the lower-right anchor at (200,210).
  const side=180*scale,shape=new Rect({left:200-side,top:210-side,width:180,height:180,strokeWidth:0,originX:'left',originY:'top',scaleX:scale,scaleY:scale});shape.setCoords();
  const scene=shape.getBoundingRect(),result=geometryFromFabric(shape,canonical(variant,'auto-height'));
  expect(result).toEqual({x:scene.left,y:scene.top,width:side,height:side,rotation:0});expect(result.x+result.width).toBe(200);expect(result.y+result.height).toBe(210);
 });
 it('retains rectangular auto-height and automatic-size constraints',()=>{
  const shape=new Rect({left:20,top:30,width:180,height:180,strokeWidth:0,scaleX:.5,scaleY:.5});
  expect(geometryFromFabric(shape,canonical('rectangle','auto-height'))).toMatchObject({width:90,height:180});
  expect(geometryFromFabric(shape,canonical('square','auto-size'))).toMatchObject({width:180,height:180});
 });
});
