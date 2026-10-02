import type { DrawingStroke, WhiteboardObject } from '@repo/whiteboard-core';
import { drawingPointBounds } from './drawing-coordinate-space';
type Point={x:number;y:number};
function pointDistance(p:Point,a:Point,b:Point){
 const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
 const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
 return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
function segmentDistance(a:Point,b:Point,c:Point,d:Point){
 const cross=(p:Point,q:Point,r:Point)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
 const x=cross(a,b,c),y=cross(a,b,d),z=cross(c,d,a),w=cross(c,d,b);
 if(x*y<0&&z*w<0)return 0;
 return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));
}
/** Only painted vectors can be eraser targets; bounding boxes alone are insufficient. */
export function eraserTargetStrokeIds(geometry:WhiteboardObject['geometry'],strokes:readonly DrawingStroke[],eraser:DrawingStroke):string[]{
 const bounds=drawingPointBounds(strokes.flatMap(stroke=>stroke.points));
 const scaleX=geometry.width/bounds.width,scaleY=geometry.height/bounds.height,radians=geometry.rotation*Math.PI/180;
 const world=(p:Point):Point=>{const x=(p.x-bounds.x)*scaleX,y=(p.y-bounds.y)*scaleY;return {x:geometry.x+x*Math.cos(radians)-y*Math.sin(radians),y:geometry.y+x*Math.sin(radians)+y*Math.cos(radians)};};
 return strokes.filter(stroke=>{
  if(stroke.tool==='eraser')return false;
  const radius=(eraser.width+stroke.width*Math.max(scaleX,scaleY))/2;
  for(let i=1;i<stroke.points.length;i++)for(let j=1;j<eraser.points.length;j++){
   if(segmentDistance(world(stroke.points[i-1]!),world(stroke.points[i]!),eraser.points[j-1]!,eraser.points[j]!)<=radius)return true;
  }
  return false;
 }).map(stroke=>stroke.id);
}
