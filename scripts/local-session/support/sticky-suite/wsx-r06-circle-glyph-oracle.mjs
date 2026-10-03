import assert from 'node:assert/strict';
import {rotatedPoint} from './wsx-r06-sticky-oracles.mjs';
export function assertCircleGlyphClipping({rgba,width,height,geometry,view,layer}){
 assert(['canvas-static','composited-editor'].includes(layer),'actual raster layer must be explicitly recorded');
 assert.equal(rgba.length,width*height*4);assert(Math.abs(geometry.width-geometry.height)<=.01);
 const corners=[[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>rotatedPoint(geometry,{x:x*geometry.width,y:y*geometry.height}));
 const css=corners.map(p=>({x:view.x+view.panX+p.x*view.zoom,y:view.y+view.panY+p.y*view.zoom}));
 const bounds={left:Math.floor(Math.min(...css.map(p=>p.x))*view.dpr),right:Math.ceil(Math.max(...css.map(p=>p.x))*view.dpr),
  top:Math.floor(Math.min(...css.map(p=>p.y))*view.dpr),bottom:Math.ceil(Math.max(...css.map(p=>p.y))*view.dpr)};
 assert(bounds.left>=0&&bounds.top>=0&&bounds.right<=width&&bounds.bottom<=height,'entire rotated paper ROI must fit the actual raster');
 const angle=geometry.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);let inside=0,outside=0;
 for(let y=bounds.top;y<bounds.bottom;y++)for(let x=bounds.left;x<bounds.right;x++){
  const index=(y*width+x)*4;if(rgba[index+3]<250||Math.max(rgba[index],rgba[index+1],rgba[index+2])>=70)continue;
  const worldX=((x+.5)/view.dpr-view.x-view.panX)/view.zoom-geometry.x;
  const worldY=((y+.5)/view.dpr-view.y-view.panY)/view.zoom-geometry.y;
  const localX=c*worldX+s*worldY,localY=-s*worldX+c*worldY;
  const ellipse=((localX-geometry.width/2)/(geometry.width/2))**2+((localY-geometry.height/2)/(geometry.height/2))**2;
  if(ellipse<.92)inside++;else if(ellipse>1.08)outside++;
 }
 assert(inside>=40*view.dpr*view.dpr,'nonblank actual glyphs are required, not an empty clipped circle');
 assert.equal(outside,0,'dark glyph pixels leak beyond the rotated circle');
 return{layer,insideGlyphPixels:inside,outsideGlyphPixels:outside,bounds,view,geometry};
}
