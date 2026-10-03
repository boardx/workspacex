import assert from 'node:assert/strict';

export function screenToWorld(point,view){
 assert(Number.isFinite(view.zoom)&&view.zoom>0);
 return{x:(point.x-view.x-view.panX)/view.zoom,y:(point.y-view.y-view.panY)/view.zoom};
}
export function rotatedPoint(geometry,local){
 const r=geometry.rotation*Math.PI/180;
 return{x:geometry.x+Math.cos(r)*local.x-Math.sin(r)*local.y,
  y:geometry.y+Math.sin(r)*local.x+Math.cos(r)*local.y};
}
export function assertNotePlacement(geometry,point,view){
 const expected=screenToWorld(point,view),actual=rotatedPoint(geometry,{x:geometry.width/2,y:geometry.height/2});
 assert(Math.abs(actual.x-expected.x)<=.01&&Math.abs(actual.y-expected.y)<=.01,'placement differs from independent inverse-screen oracle');
}
/** Blank-note raster only: caller must separately verify empty canonical text and deselection. */
export function assertStickyPixels({rgba,width,height,geometry,viewport,variant,color}){
 assert(Buffer.isBuffer(rgba)||rgba instanceof Uint8Array);
 assert.equal(rgba.length,width*height*4);
 assert(/^#[0-9a-f]{6}$/i.test(color));
 assert(['square','rectangle','circle'].includes(variant));
 const rgb=color.slice(1).match(/../g).map(value=>parseInt(value,16));
 if(variant!=='rectangle')assert(Math.abs(geometry.width-geometry.height)<=.01,'square/circle must remain proportional');
 const pixel=(fx,fy)=>{
  const point=rotatedPoint(geometry,{x:geometry.width*fx,y:geometry.height*fy});
  const x=Math.floor((viewport.x+viewport.panX+point.x*viewport.zoom)*viewport.dpr);
  const y=Math.floor((viewport.y+viewport.panY+point.y*viewport.zoom)*viewport.dpr);
  assert(x>=0&&x<width&&y>=0&&y<height,'sample must be inside actual raster');
  const i=(y*width+x)*4;
  return Array.from(rgba.slice(i,i+4));
 };
 const sameFill=value=>value[3]===255&&rgb.every((channel,index)=>Math.abs(channel-value[index])<=1);
 for(const [x,y] of [[.5,.5],[.4,.3],[.6,.3],[.3,.6],[.6,.6]])assert(sameFill(pixel(x,y)),'actual note interior does not match canonical fill');
 for(const [x,y] of [[.08,.08],[.92,.08],[.08,.92],[.92,.92]]){
  if(variant==='circle')assert(!sameFill(pixel(x,y)),'circle corners contain square-like fill');
  else assert(sameFill(pixel(x,y)),'square/rectangle corner interior is missing');
 }
 return{interiorSamples:5,cornerSamples:4,variant,dpr:viewport.dpr};
}
