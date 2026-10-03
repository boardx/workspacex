import assert from 'node:assert/strict';
import {readCanvasRaster} from './wsx-r06-raster-readers.mjs';
import {rotatedPoint} from './wsx-r06-sticky-oracles.mjs';
export function assertMagentaEdgeSamples({rgba,width,height,points,view}){
 assert.equal(rgba.length,width*height*4);assert(points.length>=3,'multiple independent path samples required');
 return points.map(point=>{
  const cx=Math.round((view.panX+point.x*view.zoom)*view.dpr),cy=Math.round((view.panY+point.y*view.zoom)*view.dpr);let ink=0;
  const radius=Math.ceil(2*view.dpr);assert(cx-radius>=0&&cy-radius>=0&&cx+radius<width&&cy+radius<height,'path sample lies outside actual raster');
  for(let y=cy-radius;y<=cy+radius;y++)for(let x=cx-radius;x<=cx+radius;x++){
   const index=(y*width+x)*4;if(rgba[index]>130&&rgba[index+1]<70&&rgba[index+2]>150&&rgba[index+3]>200)ink++;
  }
  assert(ink>0,'actual magenta existing edge does not pass the independent live anchor path');return{point,ink};
 });
}
export function createExistingEdgeRasterAdapter(ctx,owner){
 return async({movingEndpoint,fixedEndpoint,view})=>{
  const raster=await readCanvasRaster(owner),points=[.25,.5,.75].map(fraction=>({x:movingEndpoint.x+(fixedEndpoint.x-movingEndpoint.x)*fraction,y:movingEndpoint.y+(fixedEndpoint.y-movingEndpoint.y)*fraction}));
  return assertMagentaEdgeSamples({...raster,points,view});
 };
}
export function createCanonicalExistingEdgeRasterAdapter(ctx){
 return async(actor,id,expected)=>{
  const state=await ctx.state(actor),edge=state.objects.find(object=>object.id===id);assert(edge);assert.deepEqual(edge,expected);assert.equal(edge.connector.type,'straight');
  const anchors={left:[0,.5],top:[.5,0],right:[1,.5],bottom:[.5,1]};
  const point=side=>{
   const node=state.objects.find(object=>object.id===edge.connector[side]);assert(node);
   const fractions=anchors[edge.connector[`${side}Anchor`]];assert(fractions);
   return rotatedPoint(node.geometry,{x:fractions[0]*node.geometry.width,y:fractions[1]*node.geometry.height});
  };
  const from=point('from'),to=point('to'),points=[.25,.5,.75].map(fraction=>({x:from.x+(to.x-from.x)*fraction,y:from.y+(to.y-from.y)*fraction}));
  return assertMagentaEdgeSamples({...await readCanvasRaster(actor),points,view:await ctx.view(actor)});
 };
}
