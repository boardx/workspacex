import assert from 'node:assert/strict';
export function assertStrokePixelOracle({samples,scan,effective,strokeWidth}){
 assert.equal(samples.length,9);assert.equal(scan.length,41);assert([...samples,...scan].every(sample=>Number.isFinite(sample.darkness)));assert(Number.isFinite(effective)&&effective>0);
 for(const sample of samples.slice(0,5))assert(sample.darkness>60,'Center, caps and inner thickness edges must be ink');
 for(const sample of samples.slice(5))assert(sample.darkness<25,'Outside caps and thickness edges must be background');
 const indices=scan.flatMap((sample,index)=>sample.darkness>60?[index]:[]),thickness=indices.length;
 assert(Math.abs(thickness-effective)<=(strokeWidth===3?.75:1),'Thickness must match fixed mouse pressure');
 assert.equal(indices.at(-1)-indices[0]+1,thickness,'Thickness must be continuous');
 assert(Math.abs((indices[0]+indices.at(-1))/2-20)<=.5,'Thickness must be centered');
 return thickness;
}
