import {strict as assert} from 'node:assert';

export function independentProcessIds(ids){
 assert.equal(ids.length,3);assert(ids.every(id=>Number.isSafeInteger(id)&&id>0));assert.equal(new Set(ids).size,3);
 return [...ids];
}

export function acceptedGesture(before,after,submitted,acks,actors){
 assert.equal(after.epoch,before.epoch);assert.equal(after.seq,before.seq+actors.length);
 assert.equal(acks.length,actors.length);assert.equal(new Set(acks.map(ack=>ack.seq)).size,actors.length);
 assert.equal(submitted.length,actors.length);
 for(const message of [...submitted,...acks]){assert(actors.includes(message.process));assert.equal(typeof message.updateId,'string');assert(message.updateId.length>0);assert.equal(typeof message.gestureId,'string');assert(message.gestureId.length>0);}
 for(const actor of actors){
  const own=acks.filter(ack=>ack.process===actor);assert.equal(own.length,1);
  const ack=own[0];assert(ack.seq>before.seq&&ack.seq<=after.seq);
  const sent=submitted.filter(update=>update.process===actor&&update.updateId===ack.updateId&&update.gestureId===ack.gestureId);
  assert.equal(sent.length,1);assert.equal(sent[0].epoch,before.epoch);
 }
}

export function retainedConnector(expected,actual){
 for(const field of ['strokeWidth','label','route','labelPosition','fromPoint','toPoint','from','to','fromAnchor','toAnchor','semanticRelation','startStyle','endStyle','lineStyle','type'])assert.deepEqual(actual[field],expected[field]);
}

export function glyphProof(actual,expected){
 const mask=data=>{const points=[];for(let i=0;i<data.length;i+=4)if(data[i]<100&&data[i+1]<100&&data[i+2]<100&&data[i+3]>200)points.push({x:(i/4)%300,y:Math.floor(i/4/300)});assert(points.length>10);const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));return {x,y,points:new Set(points.map(p=>`${p.x-x}:${p.y-y}`)),width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y};};
 const a=mask(actual),e=mask(expected);assert(Math.abs(a.width-e.width)<=2);assert(Math.abs(a.height-e.height)<=2);
 assert(Math.abs(a.x-e.x)<=4);assert(Math.abs(a.y-e.y)<=4);
 const overlap=[...a.points].filter(point=>e.points.has(point)).length;assert(overlap/Math.max(a.points.size,e.points.size)>.65);
}

export function strokeProof(samples,expectedWidth){
 assert(Number.isFinite(expectedWidth)&&expectedWidth>=2);
 assert(samples.length>0);for(let i=0;i<samples.length;i++){assert(Number.isFinite(samples[i].offset));assert.equal(typeof samples[i].ink,'boolean');if(i>0)assert(samples[i].offset>samples[i-1].offset);}
 const ink=samples.filter(sample=>sample.ink);assert(ink.some(sample=>Math.abs(sample.offset)<=1));
 assert(Math.abs(ink.length-expectedWidth)<=1.5);
 for(const sample of samples)if(Math.abs(sample.offset)>expectedWidth/2+1.5)assert.equal(sample.ink,false);
 const first=samples.findIndex(sample=>sample.ink),last=samples.findLastIndex(sample=>sample.ink);
 assert(samples.slice(first,last+1).every(sample=>sample.ink));
}

export function curveMeasurement(start,end,route,position,target){
 const at=t=>{const u=1-t;return {x:u**3*start.x+3*u*u*t*(start.x+route.startOffset.x)+3*u*t*t*(end.x+route.endOffset.x)+t**3*end.x,y:u**3*start.y+3*u*u*t*(start.y+route.startOffset.y)+3*u*t*t*(end.y+route.endOffset.y)+t**3*end.y};};
 const points=Array.from({length:2001},(_,i)=>at(i/2000)),lengths=[0];
 for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));
 const total=lengths.at(-1);assert(total>0);
 let index=lengths.findIndex(length=>length>=total*position.t);if(index<1)index=1;
 const a=points[index-1],b=points[index],segment=lengths[index]-lengths[index-1],fraction=(total*position.t-lengths[index-1])/segment;
 const normal={x:-(b.y-a.y)/segment,y:(b.x-a.x)/segment};
 const point={x:a.x+(b.x-a.x)*fraction+normal.x*position.normalOffset,y:a.y+(b.y-a.y)*fraction+normal.y*position.normalOffset};
 if(!target)return {point};
 let best={distance:Infinity,t:0,normalOffset:0};
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,square=dx*dx+dy*dy;
  const fraction=Math.max(0,Math.min(1,((target.x-a.x)*dx+(target.y-a.y)*dy)/square)),x=a.x+fraction*dx,y=a.y+fraction*dy,distance=Math.hypot(target.x-x,target.y-y);
  if(distance<best.distance){const length=Math.sqrt(square);best={distance,t:(lengths[i-1]+fraction*length)/total,normalOffset:((target.x-x)*-dy+(target.y-y)*dx)/length};}
 }
 return {point,t:best.t,normalOffset:best.normalOffset};
}

// Bernstein-polynomial samples are intentionally independent of the product path implementation.
export function cubicSamples(start,end,route){
 for(const point of [start,end,route.startOffset,route.endOffset])assert(Number.isFinite(point.x)&&Number.isFinite(point.y));
 assert.equal(route.kind,'curve');
 return [.12,.35,.8].map(t=>{const u=1-t;return {
  x:u*u*u*start.x+3*u*u*t*(start.x+route.startOffset.x)+3*u*t*t*(end.x+route.endOffset.x)+t*t*t*end.x,
  y:u*u*u*start.y+3*u*u*t*(start.y+route.startOffset.y)+3*u*t*t*(end.y+route.endOffset.y)+t*t*t*end.y,
 };});
}
