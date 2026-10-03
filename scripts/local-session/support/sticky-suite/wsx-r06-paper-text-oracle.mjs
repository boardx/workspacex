import assert from 'node:assert/strict';
import {rotatedPoint} from './wsx-r06-sticky-oracles.mjs';
export function assertStickyPaperAndTextPixels({rgba,width,height,geometry,view,color,variant,hasText}){
 assert.equal(rgba.length,width*height*4);assert(/^#[0-9a-f]{6}$/i.test(color));const rgb=color.slice(1).match(/../g).map(channel=>parseInt(channel,16));
 const pixel=(fx,fy)=>{
  const point=rotatedPoint(geometry,{x:geometry.width*fx,y:geometry.height*fy}),x=Math.floor((view.panX+point.x*view.zoom)*view.dpr),y=Math.floor((view.panY+point.y*view.zoom)*view.dpr);
  assert(x>=0&&x<width&&y>=0&&y<height);return rgba.slice((y*width+x)*4,(y*width+x)*4+4);
 };
 let filled=0,dark=0,samples=0;
 for(let x=1;x<10;x++)for(let y=1;y<10;y++){
  const fx=x/10,fy=y/10;if(variant==='circle'&&((fx-.5)**2+(fy-.5)**2)>.15)continue;
  const p=pixel(fx,fy);samples++;if(p[3]===255&&rgb.every((channel,i)=>Math.abs(channel-p[i])<=1))filled++;
  if(p[3]>240&&Math.max(p[0],p[1],p[2])<70)dark++;
 }
 assert(filled>=Math.ceil(samples*.25),'actual paper is absent or has the wrong source-bound color');
 for(const[fx,fy]of [[.08,.08],[.92,.08],[.08,.92],[.92,.92]]){
  const p=pixel(fx,fy),same=p[3]===255&&rgb.every((channel,i)=>Math.abs(channel-p[i])<=1);
  if(variant==='circle')assert(!same,'circle raster has square-like colored corners');
 }
 if(hasText){
  const angle=geometry.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const corners=[[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>rotatedPoint(geometry,{x:x*geometry.width,y:y*geometry.height}));
  const xs=corners.map(p=>(view.panX+p.x*view.zoom)*view.dpr),ys=corners.map(p=>(view.panY+p.y*view.zoom)*view.dpr);
  const left=Math.floor(Math.min(...xs)),right=Math.ceil(Math.max(...xs)),top=Math.floor(Math.min(...ys)),bottom=Math.ceil(Math.max(...ys));
  assert(left>=0&&top>=0&&right<=width&&bottom<=height,'full note raster must fit viewport');dark=0;
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
   const wx=((x+.5)/view.dpr-view.panX)/view.zoom-geometry.x,wy=((y+.5)/view.dpr-view.panY)/view.zoom-geometry.y,lx=c*wx+s*wy,ly=-s*wx+c*wy;
   if(lx<geometry.width*.08||lx>geometry.width*.92||ly<geometry.height*.08||ly>geometry.height*.92)continue;
   if(variant==='circle'&&((lx/geometry.width-.5)**2+(ly/geometry.height-.5)**2)>.15)continue;
   const i=(y*width+x)*4;if(rgba[i+3]>240&&Math.max(rgba[i],rgba[i+1],rgba[i+2])<70)dark++;
  }
  assert(dark>0,'nonempty canonical text must have actual dark glyph raster, not blank paper');
 }
 return{samples,filled,dark,variant,hasText};
}
