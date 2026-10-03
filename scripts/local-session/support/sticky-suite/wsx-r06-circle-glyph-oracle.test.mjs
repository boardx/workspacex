import assert from 'node:assert/strict';
import test from 'node:test';
import {assertCircleGlyphClipping} from './wsx-r06-circle-glyph-oracle.mjs';
function raster(dpr){
 const width=300*dpr,height=300*dpr,rgba=Buffer.alloc(width*height*4,255);
 const dot=(x,y)=>{for(let a=0;a<8*dpr;a++)for(let b=0;b<8*dpr;b++){const i=((y*dpr+b)*width+x*dpr+a)*4;rgba[i]=rgba[i+1]=rgba[i+2]=30;}};
 dot(110,110);return{rgba,width,height,geometry:{x:100,y:50,width:120,height:120,rotation:30},view:{x:0,y:0,panX:0,panY:0,zoom:1,dpr},layer:'canvas-static',dot};
}
for(const dpr of [1,2])test(`rotated actual glyph ROI rejects leak or blank at DPR${dpr}`,()=>{
 const image=raster(dpr);assertCircleGlyphClipping(image);
 image.dot(60,55);assert.throws(()=>assertCircleGlyphClipping(image),/leak/);
 const blank=raster(dpr);blank.rgba.fill(255);assert.throws(()=>assertCircleGlyphClipping(blank),/nonblank/);
});
