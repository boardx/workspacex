import {expect,it} from 'vitest';
import {eraserTargetStrokeIds} from '@/components/whiteboard/board-drawing-eraser';
import type {DrawingStroke} from '@repo/whiteboard-core';
const pen:DrawingStroke={id:'pen',tool:'pen',width:3,opacity:1,color:'#18181B',points:[{x:0,y:0,pressure:.5},{x:100,y:100,pressure:.5}]};
const geometry={x:0,y:0,width:100,height:100,rotation:0};
const erase=(a:{x:number;y:number},b:{x:number;y:number}):DrawingStroke=>({...pen,id:'erase',tool:'eraser',width:8,points:[{...a,pressure:.5},{...b,pressure:.5}]});
it('hits a crossing vector without sampled points touching and ignores empty bounding-box corners',()=>{
 expect(eraserTargetStrokeIds(geometry,[pen],erase({x:0,y:100},{x:100,y:0}))).toEqual(['pen']);
 expect(eraserTargetStrokeIds(geometry,[pen],erase({x:80,y:5},{x:95,y:5}))).toEqual([]);
});
it('uses transformed world vectors after movement, resize and rotation, excluding eraser layers',()=>{
 expect(eraserTargetStrokeIds({...geometry,x:200,width:200,height:200,rotation:90},[pen],erase({x:80,y:100},{x:120,y:100}))).toEqual(['pen']);
 expect(eraserTargetStrokeIds(geometry,[pen,{...pen,id:'old-eraser',tool:'eraser'}],erase({x:0,y:100},{x:100,y:0}))).toEqual(['pen']);
 expect(eraserTargetStrokeIds(geometry,[pen],erase({x:200,y:200},{x:300,y:300}))).toEqual([]);
});
