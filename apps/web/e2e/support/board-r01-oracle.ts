export type R01Point = {x:number;y:number};
export type R01Geometry = R01Point & {width:number;height:number;rotation:number};

function finite(values:number[]){if(!values.every(Number.isFinite))throw new Error('R01_NONFINITE_GEOMETRY');}
function validGeometry(geometry:R01Geometry){finite([geometry.x,geometry.y,geometry.width,geometry.height,geometry.rotation]);if(geometry.width<=0||geometry.height<=0)throw new Error('R01_INVALID_ENTITY_SIZE');}
export function rotatePoint(point:R01Point,pivot:R01Point,degrees:number):R01Point{
 finite([point.x,point.y,pivot.x,pivot.y,degrees]);
 const radians=degrees*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians),x=point.x-pivot.x,y=point.y-pivot.y;
 return {x:pivot.x+x*c-y*s,y:pivot.y+x*s+y*c};
}
export function entityPoint(geometry:R01Geometry,local:R01Point):R01Point{
 validGeometry(geometry);finite([local.x,local.y]);
 return rotatePoint({x:geometry.x+local.x,y:geometry.y+local.y},geometry,geometry.rotation);
}
export const entityCorners=(geometry:R01Geometry)=>[{x:0,y:0},{x:geometry.width,y:0},{x:geometry.width,y:geometry.height},{x:0,y:geometry.height}].map(point=>entityPoint(geometry,point));
export function visualFrame(geometry:R01Geometry,padding=0):R01Geometry{validGeometry(geometry);finite([padding]);if(padding<0)throw new Error('R01_INVALID_VISUAL_PADDING');return {...geometry,width:geometry.width+padding,height:geometry.height+padding};}
export function transformGeometry(geometry:R01Geometry,pivot:R01Point,degrees:number,scale=1,translation:R01Point={x:0,y:0}):R01Geometry{
 validGeometry(geometry);finite([scale,translation.x,translation.y]);if(scale<=0)throw new Error('R01_INVALID_SCALE');
 const origin=rotatePoint({x:pivot.x+(geometry.x-pivot.x)*scale,y:pivot.y+(geometry.y-pivot.y)*scale},pivot,degrees);
 return {...geometry,x:origin.x+translation.x,y:origin.y+translation.y,width:geometry.width*scale,height:geometry.height*scale,rotation:geometry.rotation+degrees};
}
export function pointerRotation(pivot:R01Point,start:R01Point,end:R01Point){
 finite([pivot.x,pivot.y,start.x,start.y,end.x,end.y]);
 if(Math.hypot(start.x-pivot.x,start.y-pivot.y)<1||Math.hypot(end.x-pivot.x,end.y-pivot.y)<1)throw new Error('R01_DEGENERATE_ROTATION_POINTER');
 return (Math.atan2(end.y-pivot.y,end.x-pivot.x)-Math.atan2(start.y-pivot.y,start.x-pivot.x))*180/Math.PI;
}
export function offsetAnchor(geometry:R01Geometry,side:'left'|'right',offset:R01Point):R01Point{
 return entityPoint(geometry,{x:(side==='right'?geometry.width:0)+offset.x,y:geometry.height/2+offset.y});
}
export function assertPoints(actual:R01Point[],expected:R01Point[],tolerance=.01){
 finite([tolerance]);if(tolerance<0||!expected.length||actual.length!==expected.length)throw new Error('R01_MISSING_ENTITY_POINT');
 actual.forEach((point,index)=>{finite([point.x,point.y,expected[index]!.x,expected[index]!.y]);if(Math.hypot(point.x-expected[index]!.x,point.y-expected[index]!.y)>tolerance)throw new Error('R01_POINT_ERROR');});
}
export function assertAtomicRevision(before:{epoch:number;seq:number},after:{epoch:number;seq:number},delta:number){
 if(![before.epoch,after.epoch,before.seq,after.seq,delta].every(Number.isSafeInteger)||before.epoch<=0||after.epoch<=0||before.seq<0||after.seq<0||delta<0)throw new Error('R01_INVALID_REVISION');
 if(after.epoch!==before.epoch||after.seq!==before.seq+delta)throw new Error('R01_NONATOMIC_REVISION');
}
export function literalInkCount(rgba:number[],color:[number,number,number]){
 if(!rgba.length||rgba.length%4||![...rgba,...color].every(value=>Number.isInteger(value)&&value>=0&&value<=255)||color.length!==3)throw new Error('R01_INVALID_RGBA');
 let count=0;for(let index=0;index<rgba.length;index+=4)if(rgba[index+3]!>=200&&color.every((value,channel)=>Math.abs(rgba[index+channel]!-value)<=2))count++;
 return count;
}
export function assertStrokePixels(center:number[],guards:number[][],color:[number,number,number],erased=false){
 const ink=literalInkCount(center,color);
 if(erased?ink>=25:ink<=60)throw new Error('R01_STROKE_PIXEL_MISSING');
 if(!guards.length||guards.some(pixels=>literalInkCount(pixels,color)>0))throw new Error('R01_FILLED_FRAME_NOT_STROKE');
}
export function assertTransparentPixels(rgba:number[]){
 literalInkCount(rgba,[0,0,0]);
 if(rgba.some((value,index)=>index%4===3&&value!==0))throw new Error('R01_ERASE_BACKGROUND_NOT_TRANSPARENT');
}
function pointBounds(points:R01Point[]){
 if(!points.length)throw new Error('R01_DRAWING_POINTS_REQUIRED');points.forEach(point=>finite([point.x,point.y]));
 const x=Math.min(...points.map(point=>point.x)),y=Math.min(...points.map(point=>point.y));
 return {x,y,width:Math.max(1,Math.max(...points.map(point=>point.x))-x),height:Math.max(1,Math.max(...points.map(point=>point.y))-y)};
}
export function expandedDrawingGeometry(geometry:R01Geometry,oldPoints:R01Point[],worldRoute:R01Point[]):R01Geometry{
 validGeometry(geometry);if(worldRoute.length<2)throw new Error('R01_ERASE_ROUTE_REQUIRED');const source=pointBounds(oldPoints);
 const localRoute=worldRoute.map(point=>{const unrotated=rotatePoint(point,geometry,-geometry.rotation);return {x:source.x+(unrotated.x-geometry.x)*source.width/geometry.width,y:source.y+(unrotated.y-geometry.y)*source.height/geometry.height};});
 const combined=pointBounds([...oldPoints,...localRoute]),scaleX=geometry.width/source.width,scaleY=geometry.height/source.height;
 const origin=entityPoint(geometry,{x:(combined.x-source.x)*scaleX,y:(combined.y-source.y)*scaleY});
 return {...geometry,...origin,width:combined.width*scaleX,height:combined.height*scaleY};
}
export function drawingPointWorld(geometry:R01Geometry,allPoints:R01Point[],point:R01Point):R01Point{
 const bounds=pointBounds(allPoints);return entityPoint(geometry,{x:(point.x-bounds.x)*geometry.width/bounds.width,y:(point.y-bounds.y)*geometry.height/bounds.height});
}
type Stroke={id:string;tool:string;erases?:string[]};
type EraseObject={id:string;kind:string;geometry?:R01Geometry;locked?:boolean;hidden?:boolean;extensionData?:{contentObject?:unknown}};
export function assertEraseObjects(before:EraseObject[],after:EraseObject[],erasedIds:string[],expectedGeometries:Record<string,R01Geometry>={}){
 if(!erasedIds.length||new Set(erasedIds).size!==erasedIds.length||new Set(before.map(object=>object.id)).size!==before.length||erasedIds.some(id=>!before.some(object=>object.id===id)))throw new Error('R01_INVALID_ERASE_IDS');
 if(new Set(after.map(object=>object.id)).size!==after.length||after.length!==before.length)throw new Error('R01_ERASE_IDENTITY_CHANGED');
 for(const original of before){
  const result=after.find(object=>object.id===original.id);if(!result)throw new Error('R01_ERASE_OBJECT_MISSING');
  if(!erasedIds.includes(original.id)){
   if(!isDeepStrictEqual(result,original))throw new Error('R01_PROTECTED_OBJECT_CHANGED');
   continue;
  }
  if(original.kind!=='drawing'||original.locked||original.hidden)throw new Error('R01_INVALID_ERASE_TARGET');
  const a=original.extensionData?.contentObject as {strokes:Stroke[]},b=result.extensionData?.contentObject as {strokes:Stroke[]};
  if(!a||!b||b.strokes.length!==a.strokes.length+1||!isDeepStrictEqual(b.strokes.slice(0,-1),a.strokes))throw new Error('R01_OLD_STROKES_CHANGED');
  if(expectedGeometries[original.id]){
   if(!original.geometry||!result.geometry)throw new Error('R01_DRAWING_GEOMETRY_REQUIRED');
   assertPoints(entityCorners(result.geometry),entityCorners(expectedGeometries[original.id]!));
  }
  const restored={...result,...(expectedGeometries[original.id]?{geometry:original.geometry}:{}),extensionData:{...result.extensionData,contentObject:{...b,strokes:b.strokes.slice(0,-1)}}};
  if(!isDeepStrictEqual(restored,original))throw new Error('R01_ERASE_TARGET_SEMANTICS_CHANGED');
  const mask=b.strokes.at(-1)!;
  if(mask.tool!=='eraser'||!mask.id||a.strokes.some(stroke=>stroke.id===mask.id)||!mask.erases?.length||new Set(mask.erases).size!==mask.erases.length||mask.erases.some(id=>!a.strokes.some(stroke=>stroke.id===id&&stroke.tool!=='eraser')))throw new Error('R01_INVALID_ERASE_MASK');
 }
}
import {isDeepStrictEqual} from 'node:util';

// Standalone callback: Playwright serializes this function without module closures.
export function sampleLiteralShapeStroke(canvas:HTMLCanvasElement,options:{geometry:{x:number;y:number;width:number;height:number;rotation:number};grid:{sx:number;sy:number;zoom:number;panX:number;panY:number};variant?:'normal'|'none'|'wide'|'color'|'shift'|'broken'|'filled';diagnosticBands?:boolean;transformOrder?:'premultiplied'|'staged';selectionChrome?:{color:string;borderWidth:number;padding:number}}){
 const {geometry:g,grid,variant='normal'}=options;
 if(![g.x,g.y,g.width,g.height,g.rotation,grid.sx,grid.sy,grid.zoom,grid.panX,grid.panY,canvas.width,canvas.height].every(Number.isFinite)||[g.width,g.height,grid.sx,grid.sy,grid.zoom,canvas.width,canvas.height].some(value=>value<=0))throw new Error('R01_STROKE_GRID_INVALID');
 const reference=canvas.ownerDocument.createElement('canvas');reference.width=canvas.width;reference.height=canvas.height;
 const context=reference.getContext('2d'),actual=canvas.getContext('2d');if(!context||!actual)throw new Error('R01_STROKE_REFERENCE_REQUIRED');
 const radians=g.rotation*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians),center={x:g.width/2*c-g.height/2*s+g.x,y:g.width/2*s+g.height/2*c+g.y};
 if(options.transformOrder!==undefined&&!['premultiplied','staged'].includes(options.transformOrder))throw new Error('R01_STROKE_TRANSFORM_ORDER_INVALID');
 if(options.transformOrder==='staged'){context.scale(grid.sx,grid.sy);context.translate(grid.panX,grid.panY);context.scale(grid.zoom,grid.zoom);context.translate(center.x+(variant==='shift'?1:0),center.y);context.rotate(radians);}
 else context.setTransform(grid.sx*grid.zoom*c,grid.sy*grid.zoom*s,-grid.sx*grid.zoom*s,grid.sy*grid.zoom*c,grid.sx*(grid.panX+(center.x+(variant==='shift'?1:0))*grid.zoom),grid.sy*(grid.panY+center.y*grid.zoom));
 context.fillStyle=variant==='filled'?'#18181B':'#2563EB';context.strokeStyle=variant==='color'?'#FACC15':'#18181B';context.lineWidth=variant==='wide'?2:1;
 context.beginPath();context.moveTo(-g.width/2,-g.height/2);context.lineTo(g.width/2,-g.height/2);context.lineTo(g.width/2,g.height/2);context.lineTo(-g.width/2,g.height/2);context.lineTo(-g.width/2,-g.height/2);context.closePath();context.fill();
 if(variant!=='none')context.stroke();
 const sites=[{x:g.width*.4,y:0},{x:g.width,y:g.height*.4},{x:g.width*.6,y:g.height}];
 if(variant==='broken')for(const point of sites){const x=point.x-g.width/2,y=point.y-g.height/2;context.save();context.beginPath();context.rect(x-4,y-4,8,8);context.clip();context.clearRect(x-4,y-4,8,8);context.fillRect(-g.width/2,-g.height/2,g.width,g.height);context.restore();}
 const chrome=options.selectionChrome;
 if(chrome){if(!/^#[0-9a-f]{6}$/i.test(chrome.color)||!Number.isFinite(chrome.borderWidth)||chrome.borderWidth<=0||!Number.isFinite(chrome.padding)||chrome.padding<0)throw new Error('R01_CHROME_REFERENCE_INVALID');context.setTransform(grid.sx*c,grid.sy*s,-grid.sx*s,grid.sy*c,grid.sx*(grid.panX+center.x*grid.zoom),grid.sy*(grid.panY+center.y*grid.zoom));context.strokeStyle=chrome.color;context.lineWidth=chrome.borderWidth;const width=g.width*grid.zoom+chrome.borderWidth+2*chrome.padding,height=g.height*grid.zoom+chrome.borderWidth+2*chrome.padding;context.strokeRect(-width/2,-height/2,width,height);}
 const edges=[{start:{x:0,y:0},end:{x:g.width,y:0},normal:{x:0,y:-1}},{start:{x:g.width,y:0},end:{x:g.width,y:g.height},normal:{x:1,y:0}},{start:{x:g.width,y:g.height},end:{x:0,y:g.height},normal:{x:0,y:1}},{start:{x:0,y:g.height},end:{x:0,y:0},normal:{x:-1,y:0}}];
 // These sparse diagnostic samples are not an area integral or complete filter support.
 const supportBands=options.diagnosticBands?edges.map(edge=>Array.from({length:17},(_,index)=>{const t=.1+.8*index/16;return Array.from({length:17},(_,band)=>{const distance=(band-8)*.5/grid.zoom,point={x:edge.start.x+(edge.end.x-edge.start.x)*t+edge.normal.x*distance,y:edge.start.y+(edge.end.y-edge.start.y)*t+edge.normal.y*distance};const x=Math.floor(grid.sx*(grid.panX+(g.x+point.x*c-point.y*s)*grid.zoom)),y=Math.floor(grid.sy*(grid.panY+(g.y+point.x*s+point.y*c)*grid.zoom));if(x<0||y<0||x>=canvas.width||y>=canvas.height)throw new Error('R01_STROKE_ROI_OUT_OF_BOUNDS');return {t,distanceCSS:(band-8)*.5,x,y,cellKey:`${x},${y}`,observed:[...actual.getImageData(x,y,1,1).data],reference:[...context.getImageData(x,y,1,1).data]};});})):undefined;
 return sites.map((point,index)=>{const x=Math.floor(grid.sx*(grid.panX+(g.x+point.x*c-point.y*s)*grid.zoom))-2,y=Math.floor(grid.sy*(grid.panY+(g.y+point.x*s+point.y*c)*grid.zoom))-2;if(x<0||y<0||x+5>canvas.width||y+5>canvas.height)throw new Error('R01_STROKE_ROI_OUT_OF_BOUNDS');return {roi:{x,y,size:5},observed:[...actual.getImageData(x,y,5,5).data],reference:[...context.getImageData(x,y,5,5).data],...(index===0&&supportBands?{supportBands}: {})};});
}
