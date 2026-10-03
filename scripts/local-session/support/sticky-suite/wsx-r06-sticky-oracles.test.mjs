import assert from 'node:assert/strict';
import test from 'node:test';
import {screenToWorld, rotatedPoint, assertNotePlacement, assertStickyPixels} from './wsx-r06-sticky-oracles.mjs';
const view={x:17,y:64,panX:31,panY:-19,zoom:1.65,dpr:2};
test('independent placement rejects CSS/world or pan confusion',()=>{
 const point=screenToWorld({x:213,y:375},view);
 const geometry={x:point.x-90,y:point.y-90,width:180,height:180,rotation:0};
 assertNotePlacement(geometry,{x:213,y:375},view);
 assert.throws(()=>assertNotePlacement({...geometry,x:geometry.x+31},{x:213,y:375},view));
 assert.throws(()=>assertNotePlacement(geometry,{x:213,y:375},{...view,panX:0}));
});
test('rotation uses canonical top-left origin, never center-origin helpers',()=>{
 const point=rotatedPoint({x:10,y:20,width:180,height:180,rotation:90},{x:0,y:90});
 assert(Math.abs(point.x+80)<1e-10&&Math.abs(point.y-20)<1e-10);
});
function fixture(variant,dpr=1){
 const width=240*dpr,height=240*dpr,rgba=Buffer.alloc(width*height*4,255),rgb=[255,236,153];
 const geometry={x:40,y:40,width:160,height:160,rotation:0},viewport={x:0,y:0,panX:0,panY:0,zoom:1,dpr};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const a=(x+.5)/dpr,b=(y+.5)/dpr,inside=variant==='circle'?((a-120)/80)**2+((b-120)/80)**2<=1:a>=40&&a<200&&b>=40&&b<200;
  if(inside){const i=(y*width+x)*4;for(let c=0;c<3;c++)rgba[i+c]=rgb[c];}
 }
 return{rgba,width,height,geometry,viewport,variant,color:'#FFEC99'};
}
for(const dpr of [1,2])test(`actual raster silhouette rejects wrong color and square disguised as circle at DPR${dpr}`,()=>{
 assertStickyPixels(fixture('circle',dpr));
 assertStickyPixels(fixture('square',dpr));
 assert.throws(()=>assertStickyPixels({...fixture('circle',dpr),color:'#C7DEFF'}));
 assert.throws(()=>assertStickyPixels({...fixture('square',dpr),variant:'circle'}));
});
