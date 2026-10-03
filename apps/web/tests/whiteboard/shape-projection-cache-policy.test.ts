import {describe,expect,it,vi} from 'vitest';
vi.mock('fabric',async()=>await import('fabric/node'));
import {ShapeProjectionGroup} from '../../components/whiteboard/fabric/shape-projection-group';
import {sampleLiteralShapeStroke} from '../../e2e/support/board-r01-oracle';

async function fixture(options: {x?:number;rotation?:number;width?:number;zoom?:number} = {}) {
 const f=await import('fabric/node'),width=options.width??64;
 const geometry={x:options.x??70,y:60,width,height:56,rotation:options.rotation??0};
 const shape=new f.Rect({width,height:56,fill:'#2563EB',stroke:'#18181B',strokeWidth:1,strokeUniform:true,originX:'center',originY:'center',objectCaching:true});
 const group=new ShapeProjectionGroup([shape],{layoutManager:new f.LayoutManager(new f.FixedLayout()),width,height:56,objectCaching:true,left:geometry.x,top:geometry.y,angle:geometry.rotation,originX:'left',originY:'top'});
 const canvas=new f.StaticCanvas(undefined,{width:600,height:600,renderOnAddRemove:false});
 canvas.add(group);const zoom=options.zoom??2;canvas.setViewportTransform([zoom,0,0,zoom,20,20]);
 return {f,canvas,group,shape,geometry,grid:{sx:1,sy:1,zoom,panX:20,panY:20}};
}

describe('shape cache fidelity policy',()=>{
 it('retains a real bitmap cache on the unrotated integer backing lattice',async()=>{
  for(const zoom of [1,2]){
   const {canvas,group,shape,geometry,grid}=await fixture({zoom});
   try{canvas.renderAll();expect(group.ownCaching).toBe(true);expect(group.objectCaching).toBe(true);expect(shape.objectCaching).toBe(true);
    for(const sample of sampleLiteralShapeStroke(canvas.lowerCanvasEl,{geometry,grid}))expect(Math.max(...sample.observed.map((v,i)=>Math.abs(v-sample.reference[i]!)))).toBeLessThanOrEqual(5);
   }finally{await canvas.dispose();}
  }
 });
 it.each([{rotation:17},{rotation:90},{x:70.125},{zoom:.5}])('draws unsafe backing transforms directly while preserving cache requests: %j',async options=>{
  const {canvas,group,shape,geometry,grid}=await fixture(options);
  try{canvas.renderAll();expect(group.ownCaching).toBe(false);expect(shape.ownCaching).toBe(false);expect(group.objectCaching).toBe(true);expect(shape.objectCaching).toBe(true);
   for(const sample of sampleLiteralShapeStroke(canvas.lowerCanvasEl,{geometry,grid}))expect(Math.max(...sample.observed.map((v,i)=>Math.abs(v-sample.reference[i]!)))).toBeLessThanOrEqual(5);
  }finally{await canvas.dispose();}
 });
 it('uses viewport translation, retina scaling, and parent rotation in the full backing transform',async()=>{
  const {f,canvas,group}=await fixture({zoom:1});
  try{
   expect(group.shouldCache()).toBe(true);
   canvas.setViewportTransform([1,0,0,1,20.25,20]);expect(group.shouldCache()).toBe(false);
   vi.spyOn(canvas,'getRetinaScaling').mockReturnValue(4);expect(group.shouldCache()).toBe(true);
   canvas.setViewportTransform([1,0,0,1,20,20]);
   canvas.remove(group);const parent=new f.Group([group],{angle:17});canvas.add(parent);expect(group.shouldCache()).toBe(false);
  }finally{await canvas.dispose();}
 });
 it('keeps the raw cached Fabric projection as a failing pixel counterexample',async()=>{
  const {f,canvas,group,shape,geometry,grid}=await fixture({rotation:17,width:65});
  try{canvas.remove(group);group.remove(shape);const raw=new f.Group([shape],{layoutManager:new f.LayoutManager(new f.FixedLayout()),width:65,height:56,objectCaching:true,left:geometry.x,top:geometry.y,angle:17,originX:'left',originY:'top'});canvas.add(raw);canvas.renderAll();expect(raw.ownCaching).toBe(true);
   expect(sampleLiteralShapeStroke(canvas.lowerCanvasEl,{geometry,grid}).some(s=>s.observed.some((v,i)=>Math.abs(v-s.reference[i]!)>5))).toBe(true);
  }finally{await canvas.dispose();}
 });
 it('keeps isolated clipping caches and unstroked groups on the Fabric path',async()=>{
  const {f,canvas,group,shape}=await fixture({rotation:17});
  try{
   shape.set('stroke',undefined);expect(group.shouldCache()).toBe(true);
   shape.set('stroke','#18181B');group.clipPath=new f.Rect({width:64,height:56});expect(group.shouldCache()).toBe(true);
  }finally{await canvas.dispose();}
 });
});
