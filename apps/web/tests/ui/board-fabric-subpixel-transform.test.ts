import {Rect,ActiveSelection} from 'fabric';
import {describe,expect,it} from 'vitest';
import {geometryFromFabric,geometryFromFabricSceneTransform} from '@/components/whiteboard/fabric/board-fabric-surface';
import {createWhiteboardDocument,executeCommands,readObjects,WhiteboardUndo} from '@repo/whiteboard-core';
const geometry={x:550,y:256.5,width:180,height:180,rotation:0};
describe('fractional canonical Fabric transforms',()=>{
 for(const [dx,dy] of [[12,8],[90,60]])it(`preserves the fractional origin after ${dx},${dy} movement`,()=>{
  const rect=new Rect({left:geometry.x+dx!,top:geometry.y+dy!,width:180,height:180,strokeWidth:0,originX:'left',originY:'top'});
  expect(geometryFromFabric(rect)).toEqual({...geometry,x:geometry.x+dx!,y:geometry.y+dy!});
 });
 it('preserves ActiveSelection scene coordinates and round trips one canonical undo',()=>{
  const doc=createWhiteboardDocument();executeCommands(doc,[{type:'create',object:{id:'free',schemaVersion:1,kind:'rectangle',geometry,text:'',style:{},parentId:null,orderKey:''}}],{});
  const rect=new Rect({left:geometry.x,top:geometry.y,width:180,height:180,strokeWidth:0,originX:'left',originY:'top'});
  const other=new Rect({left:850,top:256.5,width:180,height:180,strokeWidth:0,originX:'left',originY:'top'});
  const selection=new ActiveSelection([rect,other]);selection.set({left:selection.left+90,top:selection.top+60});selection.setCoords();
  const next=geometryFromFabricSceneTransform(rect);expect(next).toEqual({...geometry,x:640,y:316.5});
  const undo=new WhiteboardUndo(doc);undo.execute([{type:'geometry',id:'free',geometry:next}]);expect(readObjects(doc)[0]?.geometry).toEqual(next);
  expect(undo.undo()).toBe('undone');expect(readObjects(doc)[0]?.geometry).toEqual(geometry);
  undo.destroy();doc.destroy();selection.dispose();
 });
 it('does not round fractional dimensions and angles during a translation',()=>{
  const rect=new Rect({left:10.125,top:20.375,width:100.5,height:80.25,angle:12.5,strokeWidth:0,originX:'left',originY:'top'});
  expect(geometryFromFabric(rect)).toEqual({x:10.125,y:20.375,width:100.5,height:80.25,rotation:12.5});
 });
});
