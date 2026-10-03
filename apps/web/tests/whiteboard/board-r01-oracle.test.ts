import {describe,it,expect} from 'vitest';
import {Rect,Group,ActiveSelection} from 'fabric';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BOARD_FABRIC_VISUAL} from '../../components/whiteboard/fabric/board-fabric-visual';
import {sampleLiteralShapeStroke,assertAtomicRevision,assertEraseObjects,assertPoints,assertStrokePixels,assertTransparentPixels,drawingPointWorld,expandedDrawingGeometry,entityCorners,offsetAnchor,rotatePoint,transformGeometry,visualFrame} from '../../e2e/support/board-r01-oracle';

describe('independent R01 oracle rejects misleading geometry and partial transactions',()=>{
 const geometry={x:40,y:30,width:100,height:60,rotation:30},pivot={x:160,y:120};
 it('compares FixedLayout stroke pixels to the browser single-source reference at both zooms',async()=>{
  const fabric=await import('fabric/node');
  const diagnostics:Array<Record<string,unknown>>=[];
  const imageDirectory=process.env.BOARD_R01_PIXEL_DIAGNOSTICS==='1'?await mkdtemp(join(tmpdir(),'wsx-r01-pixel-')):undefined;
  if(imageDirectory)console.log(JSON.stringify({r01PixelDiagnosticDirectory:imageDirectory}));
  for(const zoom of [.5,2])for(const rotation of [17,-21]){
   const geometry={x:70.125,y:60.375,width:65,height:55,rotation},canvas=new fabric.StaticCanvas(undefined,{width:600,height:600,renderOnAddRemove:false});
   try{
    const shape=new fabric.Rect({width:65,height:55,fill:'#2563EB',stroke:'#18181B',strokeWidth:1,strokeUniform:true,originX:'center',originY:'center'}),group=new fabric.Group([shape],{layoutManager:new fabric.LayoutManager(new fabric.FixedLayout()),width:65,height:55});group.set({left:geometry.x,top:geometry.y,angle:rotation,originX:'left',originY:'top'});canvas.add(group);canvas.setViewportTransform([zoom,0,0,zoom,20,20]);
    const grid={sx:1,sy:1,zoom,panX:20,panY:20};
    for(const caching of ['default',true,false] as const){
     if(caching!=='default'){group.set('objectCaching',caching);shape.set('objectCaching',caching);}canvas.renderAll();assertPoints(group.getCoords(),entityCorners(geometry));
     if(imageDirectory)await writeFile(join(imageDirectory,`shape-${zoom}-${rotation}-${caching}.png`),canvas.getNodeCanvas().toBuffer('image/png'),{mode:0o600,flag:'wx'});
     // Temporary diagnostic retains the previously passing literal path separately.
     const manual=fabric.getEnv().document.createElement('canvas');manual.width=600;manual.height=600;const ctx=manual.getContext('2d')!,radians=rotation*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians),center={x:65/2*c-55/2*s+geometry.x,y:65/2*s+55/2*c+geometry.y};ctx.setTransform(zoom*c,zoom*s,-zoom*s,zoom*c,20+center.x*zoom,20+center.y*zoom);ctx.fillStyle='#2563EB';ctx.strokeStyle='#18181B';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(-65/2,-55/2);ctx.lineTo(65/2,-55/2);ctx.lineTo(65/2,55/2);ctx.lineTo(-65/2,55/2);ctx.lineTo(-65/2,-55/2);ctx.closePath();ctx.fill();ctx.stroke();
     const sites=[{x:26,y:0},{x:65,y:22},{x:39,y:55}];
     for(const [edge,sample] of sampleLiteralShapeStroke(canvas.lowerCanvasEl,{geometry,grid}).entries()){const point=sites[edge]!,x=Math.floor(20+(geometry.x+point.x*c-point.y*s)*zoom)-2,y=Math.floor(20+(geometry.y+point.x*s+point.y*c)*zoom)-2,old=[...ctx.getImageData(x,y,5,5).data],differences=sample.observed.map((value,index)=>Math.abs(value-sample.reference[index]!)),offending=sample.observed.flatMap((_,index)=>index%4===0&&differences.slice(index,index+4).some(value=>value>5)?[{pixel:index/4,actual:sample.observed.slice(index,index+4),reference:sample.reference.slice(index,index+4),manual:old.slice(index,index+4)}]:[]);diagnostics.push({zoom,rotation,caching,edge,groupCache:group.objectCaching,childCache:shape.objectCaching,backing:[canvas.lowerCanvasEl.width,canvas.lowerCanvasEl.height],sameDocument:canvas.lowerCanvasEl.ownerDocument===fabric.getEnv().document,max:Math.max(...differences),manualMax:Math.max(...sample.observed.map((value,index)=>Math.abs(value-old[index]!))),referencesMax:Math.max(...old.map((value,index)=>Math.abs(value-sample.reference[index]!))),offending});}
     for(const variant of ['none','wide','color','shift','broken','filled'] as const)for(const [edge,sample] of sampleLiteralShapeStroke(canvas.lowerCanvasEl,{geometry,grid,variant}).entries())expect(Math.max(...sample.observed.map((value,index)=>Math.abs(value-sample.reference[index]!))),`${zoom}/${rotation}/${variant}/edge${edge}`).toBeGreaterThan(5);
    }
   }finally{await canvas.dispose();}
  }
  expect(diagnostics.every(value=>(value.max as number)<=5),JSON.stringify(diagnostics)).toBe(true);
 });
 it('rejects legacy absorbed stroke bounds as canonical dimensions; not a new product projection golden',()=>{
  const geometry={x:180,y:195,width:65,height:55,rotation:-21},group=new Group([new Rect({width:65,height:55,strokeWidth:1,strokeUniform:true,originX:'center',originY:'center'})]);group.set({left:180,top:195,originX:'left',originY:'top',angle:-21});group.setCoords();
  expect([group.width,group.height,group.strokeWidth]).toEqual([66,56,0]);assertPoints(group.getCoords(),entityCorners(visualFrame(geometry,1)));
  expect(()=>assertPoints(group.getCoords(),entityCorners(geometry))).toThrow();expect(()=>assertPoints(group.getCoords(),entityCorners(visualFrame(geometry,2)))).toThrow();
  const other=new Rect({left:70,top:150,width:60,height:45,angle:17,strokeWidth:0}),selection=new ActiveSelection([group,other]);selection.set({left:selection.left+21,top:selection.top+23});selection.setCoords();
  assertPoints(group.getCoords(),entityCorners({...visualFrame(geometry,1),x:201,y:218}));expect(()=>assertPoints(entityCorners({...geometry,width:66,height:56}),entityCorners(geometry))).toThrow();selection.dispose();
 });
 it('checks independent reference on held selection scaling and fresh hydration',async()=>{
  const fabric=await import('fabric/node'),canvas=new fabric.Canvas(undefined,{width:600,height:600,renderOnAddRemove:false});
  const baseline={x:70.125,y:60.375,width:65,height:55,rotation:-21};
  const make=(geometry=baseline)=>{const group=new fabric.Group([new fabric.Rect({width:geometry.width,height:geometry.height,fill:'#2563EB',stroke:'#18181B',strokeWidth:1,strokeUniform:true,originX:'center',originY:'center'})],{layoutManager:new fabric.LayoutManager(new fabric.FixedLayout()),width:geometry.width,height:geometry.height});group.set({...BOARD_FABRIC_VISUAL.selection,left:geometry.x,top:geometry.y,angle:geometry.rotation,originX:'left',originY:'top',padding:0});return group;};
  try{
   const group=make(),peerGeometry={x:210,y:135,width:25,height:20,rotation:0},peer=new fabric.Rect({left:peerGeometry.x,top:peerGeometry.y,width:25,height:20,strokeWidth:0,fill:'transparent',originX:'left',originY:'top'});canvas.add(group,peer);const selection=new fabric.ActiveSelection([group,peer],{canvas});canvas.setActiveObject(selection);const corners=[...entityCorners(baseline),...entityCorners(peerGeometry)],pivot={x:(Math.min(...corners.map(point=>point.x))+Math.max(...corners.map(point=>point.x)))/2,y:(Math.min(...corners.map(point=>point.y))+Math.max(...corners.map(point=>point.y)))/2};selection.set({originX:'center',originY:'center',left:pivot.x,top:pivot.y,scaleX:1.2,scaleY:1.2});selection.setCoords();canvas.setViewportTransform([2,0,0,2,20,20]);canvas.renderAll();
   const expected=transformGeometry(baseline,pivot,0,1.2);assertPoints(group.getCoords(),entityCorners(expected));
   for(const selectionChrome of [undefined,{color:'#FF00FF',borderWidth:1,padding:0}])for(const [edge,sample] of sampleLiteralShapeStroke(canvas.lowerCanvasEl,{geometry:expected,grid:{sx:1,sy:1,zoom:2,panX:20,panY:20},selectionChrome}).entries())expect(Math.max(...sample.observed.map((value,index)=>Math.abs(value-sample.reference[index]!))),`missing/wrong held chrome edge${edge}`).toBeGreaterThan(5);
   for(const [edge,sample] of sampleLiteralShapeStroke(canvas.lowerCanvasEl,{geometry:expected,grid:{sx:1,sy:1,zoom:2,panX:20,panY:20},selectionChrome:{color:BOARD_FABRIC_VISUAL.selection.borderColor,borderWidth:BOARD_FABRIC_VISUAL.selection.borderScaleFactor,padding:0}}).entries())expect(Math.max(...sample.observed.map((value,index)=>Math.abs(value-sample.reference[index]!))),JSON.stringify({phase:'held-composite',edge,inputScale:1.2,groupScaling:group.getObjectScaling(),childScaling:group.getObjects()[0]!.getObjectScaling(),offending:sample.observed.flatMap((_,index)=>index%4===0&&sample.observed.slice(index,index+4).some((value,channel)=>Math.abs(value-sample.reference[index+channel]!)>5)?[{pixel:index/4,actual:sample.observed.slice(index,index+4),reference:sample.reference.slice(index,index+4)}]:[])})).toBeLessThanOrEqual(5);
   canvas.discardActiveObject();canvas.remove(group,peer);const fresh=make(expected);canvas.add(fresh);canvas.renderAll();
   for(const sample of sampleLiteralShapeStroke(canvas.lowerCanvasEl,{geometry:expected,grid:{sx:1,sy:1,zoom:2,panX:20,panY:20}}))expect(Math.max(...sample.observed.map((value,index)=>Math.abs(value-sample.reference[index]!))),'fresh stroke').toBeLessThanOrEqual(5);
  }finally{await canvas.dispose();}
 });
 it('proves backing-grid scaling and rejects invalid reference inputs',async()=>{
  const fabric=await import('fabric/node'),canvas=new fabric.StaticCanvas(undefined,{width:600,height:600,renderOnAddRemove:false}),geometry={x:70.125,y:60.375,width:65,height:55,rotation:17};
  try{
   canvas.add(new fabric.Group([new fabric.Rect({width:65,height:55,fill:'#2563EB',stroke:'#18181B',strokeWidth:1,strokeUniform:true,originX:'center',originY:'center'})],{layoutManager:new fabric.LayoutManager(new fabric.FixedLayout()),width:65,height:55,left:geometry.x,top:geometry.y,angle:17,originX:'left',originY:'top'}));
   for(const [sx,sy] of [[2,2],[2,1.5]] as const){const grid={sx,sy,zoom:2,panX:20,panY:20};canvas.setViewportTransform([sx*2,0,0,sy*2,sx*20,sy*20]);canvas.renderAll();for(const sample of sampleLiteralShapeStroke(canvas.lowerCanvasEl,{geometry,grid}))expect(Math.max(...sample.observed.map((value,index)=>Math.abs(value-sample.reference[index]!)))).toBeLessThanOrEqual(5);}
   const grid={sx:1,sy:1,zoom:1,panX:20,panY:20};
   const original=sampleLiteralShapeStroke(canvas.lowerCanvasEl,{geometry,grid}),diagnostic=sampleLiteralShapeStroke(canvas.lowerCanvasEl,{geometry,grid,diagnosticBands:true});
   expect(diagnostic.map(({supportBands,...sample})=>sample)).toEqual(original);
   const bands=diagnostic[0]!.supportBands!;expect(bands).toHaveLength(4);
   for(const edge of bands){expect(edge).toHaveLength(17);for(const site of edge){expect(site).toHaveLength(17);for(const cell of site){expect(cell.cellKey).toBe(`${cell.x},${cell.y}`);expect(cell.observed).toHaveLength(4);expect(cell.reference).toHaveLength(4);}}}
   for(const value of [NaN,Infinity,-Infinity]){expect(()=>sampleLiteralShapeStroke(canvas.lowerCanvasEl,{geometry:{...geometry,x:value},grid,diagnosticBands:true})).toThrow();expect(()=>sampleLiteralShapeStroke(canvas.lowerCanvasEl,{geometry,grid:{...grid,sx:value},diagnosticBands:true})).toThrow();}
   expect(()=>sampleLiteralShapeStroke(canvas.lowerCanvasEl,{geometry,grid:{...grid,zoom:0}})).toThrow();expect(()=>sampleLiteralShapeStroke(canvas.lowerCanvasEl,{geometry:{...geometry,x:-1000},grid})).toThrow('R01_STROKE_ROI_OUT_OF_BOUNDS');expect(()=>sampleLiteralShapeStroke(canvas.lowerCanvasEl,{geometry:{...geometry,x:1000},grid})).toThrow('R01_STROKE_ROI_OUT_OF_BOUNDS');
  }finally{await canvas.dispose();}
 });
 it('identifies lower-canvas selection chrome as a covered-frame diagnostic, not native stroke evidence',async()=>{
  const fabric=await import('fabric/node'),canvas=new fabric.Canvas(undefined,{width:600,height:600,renderOnAddRemove:false}),geometry={x:70.125,y:60.375,width:65,height:55,rotation:-21};
  try{
   const group=new fabric.Group([new fabric.Rect({width:65,height:55,fill:'#2563EB',stroke:'#18181B',strokeWidth:1,strokeUniform:true,originX:'center',originY:'center'})],{layoutManager:new fabric.LayoutManager(new fabric.FixedLayout()),width:65,height:55});group.set({left:geometry.x,top:geometry.y,angle:-21,originX:'left',originY:'top'});canvas.add(group);canvas.setActiveObject(new fabric.ActiveSelection([group],{canvas,borderColor:'#B2CCFF'}));canvas.setViewportTransform([2,0,0,2,20,20]);canvas.renderAll();
   const grid={sx:1,sy:1,zoom:2,panX:20,panY:20},covered=sampleLiteralShapeStroke(canvas.lowerCanvasEl,{geometry,grid});expect(covered.some(sample=>sample.observed.some((value,index)=>Math.abs(value-sample.reference[index]!)>5))).toBe(true);
   // Causal diagnostic only; production and the native matrix retain controls.
   canvas.skipControlsDrawing=true;canvas.renderAll();for(const sample of sampleLiteralShapeStroke(canvas.lowerCanvasEl,{geometry,grid}))expect(Math.max(...sample.observed.map((value,index)=>Math.abs(value-sample.reference[index]!)))).toBeLessThanOrEqual(5);
  }finally{await canvas.dispose();}
 });
 it('rotates all entity corners about the input-defined group pivot',()=>{
  const expected=entityCorners(geometry).map(point=>rotatePoint(point,pivot,47));
  assertPoints(entityCorners(transformGeometry(geometry,pivot,47)),expected);
  expect(()=>assertPoints(entityCorners(transformGeometry(geometry,{x:0,y:0},47)),expected)).toThrow();
  expect(()=>assertPoints(expected.slice(0,3),expected)).toThrow();
 });
 it('local endpoint offsets rotate once before the group transform',()=>{
  const endpoint=offsetAnchor(geometry,'right',{x:11,y:-7});
  const result=transformGeometry(geometry,pivot,47,1.4);
  const scaled={x:pivot.x+(endpoint.x-pivot.x)*1.4,y:pivot.y+(endpoint.y-pivot.y)*1.4};
  const expected=rotatePoint(scaled,pivot,47);
  assertPoints([offsetAnchor(result,'right',{x:11*1.4,y:-7*1.4})],[expected]);
  expect(()=>assertPoints([{x:result.x+result.width+11,y:result.y+result.height/2-7}],[expected])).toThrow();
  expect(()=>assertPoints([rotatePoint(offsetAnchor(result,'right',{x:15.4,y:-9.8}),result,47)],[expected])).toThrow();
 });
 it('scaled geometry keeps signed offsets in fixed local units',()=>{
  const scaled={x:100,y:50,width:200,height:120,rotation:90};
  assertPoints([offsetAnchor(scaled,'right',{x:7,y:-9})],[{x:49,y:257}]);
  expect(()=>assertPoints([offsetAnchor(scaled,'right',{x:14,y:-18})],[{x:49,y:257}])).toThrow();
 });
 it('expands rotated drawing bounds from input route while preserving intrinsic old points and world ink',()=>{
  const old=[{x:10,y:20},{x:50,y:40}],g={x:100,y:80,width:80,height:40,rotation:90},route=[{x:100,y:60},{x:40,y:220}];
  const expanded=expandedDrawingGeometry(g,old,route);
  assertPoints(entityCorners(expanded),entityCorners({x:100,y:60,width:160,height:60,rotation:90}));
  const mask=[{x:0,y:20},{x:80,y:50}];
  for(const point of old)assertPoints([drawingPointWorld(expanded,[...old,...mask],point)],[drawingPointWorld(g,old,point)]);
  expect(()=>assertPoints([drawingPointWorld(g,[...old,...mask],old[0]!)],[drawingPointWorld(g,old,old[0]!)])).toThrow();
 });
 it('rejects two commits and wrong epochs',()=>{
  assertAtomicRevision({epoch:1,seq:8},{epoch:1,seq:9},1);
  expect(()=>assertAtomicRevision({epoch:1,seq:8},{epoch:1,seq:10},1)).toThrow();
  expect(()=>assertAtomicRevision({epoch:1,seq:8},{epoch:2,seq:9},1)).toThrow();
 });
 it('distinguishes actual stroke ink from a frame or uniform fill',()=>{
  const ink=Array.from({length:81},()=>[24,24,27,255]).flat(),clear=Array.from({length:81},()=>[255,255,255,255]).flat();
  assertStrokePixels(ink,[clear],[24,24,27]);assertStrokePixels(clear,[clear],[24,24,27],true);
  expect(()=>assertStrokePixels(clear,[ink],[24,24,27])).toThrow();
  expect(()=>assertStrokePixels(ink,[ink],[24,24,27])).toThrow();
  assertTransparentPixels(Array(81*4).fill(0));expect(()=>assertTransparentPixels(clear)).toThrow();
  expect(()=>assertStrokePixels([],[],[24,24,27],true)).toThrow();
  expect(()=>assertStrokePixels(ink,[],[24,24,27])).toThrow();
 });
 it('rejects nonfinite expected points, revisions, samples and invalid dimensions',()=>{
  expect(()=>assertPoints([{x:0,y:0}],[{x:NaN,y:0}])).toThrow();
  expect(()=>assertPoints([{x:0,y:0}],[{x:0,y:0}],NaN)).toThrow();
  expect(()=>assertAtomicRevision({epoch:1,seq:Infinity},{epoch:1,seq:Infinity},1)).toThrow();
  expect(()=>entityCorners({...geometry,width:-1})).toThrow();
  expect(()=>assertTransparentPixels([0,0,0,NaN])).toThrow();
 });
 it('requires every drawing old stroke and all protected objects to survive',()=>{
  const drawing=(id:string,locked=false)=>({id,kind:'drawing',locked,extensionData:{contentObject:{strokes:[{id:`${id}-pen`,tool:'pen'}]}}});
  const before=[drawing('a'),drawing('b'),drawing('locked',true),{id:'sticky',kind:'sticky'}];
  const after=before.map(object=>object.id==='a'||object.id==='b'?{...object,extensionData:{contentObject:{strokes:[{id:`${object.id}-pen`,tool:'pen'},{id:`${object.id}-mask`,tool:'eraser',erases:[`${object.id}-pen`]}]}}}:object);
  assertEraseObjects(before,after,['a','b']);
  expect(()=>assertEraseObjects(before,before,[])).toThrow();
  expect(()=>assertEraseObjects(before,after,['a','a'])).toThrow();
  expect(()=>assertEraseObjects(before,after,['missing'])).toThrow();
  expect(()=>assertEraseObjects(before,[after[0]!,before[1]!,...after.slice(2)],['a','b'])).toThrow();
  expect(()=>assertEraseObjects(before,after.map(object=>object.id==='locked'?{...object,locked:false}:object),['a','b'])).toThrow();
  expect(()=>assertEraseObjects(before,after.map(object=>object.id==='a'?{...object,extensionData:{contentObject:{strokes:[{id:'mask',tool:'eraser',erases:['a-pen']}]}}}:object),['a','b'])).toThrow();
 });
});
