import assert from 'node:assert/strict';
import test from 'node:test';
import {assertStickyPaperAndTextPixels} from './wsx-r06-paper-text-oracle.mjs';
test('text-bearing paper rejects blank text raster and wrong color',()=>{
 const width=60,height=60,rgba=new Uint8Array(width*height*4),geometry={x:10,y:10,width:40,height:40,rotation:0},view={panX:0,panY:0,zoom:1,dpr:1};
 for(let y=10;y<50;y++)for(let x=10;x<50;x++)rgba.set([255,0,0,255],(y*width+x)*4);
 const run=color=>assertStickyPaperAndTextPixels({rgba,width,height,geometry,view,color,variant:'square',hasText:true});
 assert.throws(()=>run('#FF0000'),/glyph raster/);assert.throws(()=>run('#00FF00'),/wrong source-bound color/);
 rgba.set([0,0,0,255],(30*width+30)*4);assert.equal(run('#FF0000').dark,1);
});
