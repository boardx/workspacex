import assert from 'node:assert/strict';
import test from 'node:test';
import {assertMagentaEdgeSamples} from './wsx-r06-edge-raster.mjs';
test('actual edge oracle rejects blank, wrong-color and old-only path raster',()=>{
 const width=100,height=100,rgba=new Uint8Array(width*height*4),points=[{x:25,y:30},{x:50,y:30},{x:75,y:30}],view={panX:0,panY:0,zoom:1,dpr:1};
 const run=()=>assertMagentaEdgeSamples({rgba,width,height,points,view});assert.throws(run,/does not pass/);
 const paint=(point,r,g,b)=>rgba.set([r,g,b,255],(point.y*width+point.x)*4);
 for(const point of points)paint(point,0,0,0);assert.throws(run,/does not pass/);
 for(const point of points)paint({x:point.x,y:point.y+10},204,0,255);assert.throws(run,/does not pass/);
 for(const point of points)paint(point,204,0,255);assert.equal(run().length,3);
});
