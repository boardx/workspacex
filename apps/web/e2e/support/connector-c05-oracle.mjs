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

function glyphMask(data){
 const points=[];for(let i=0;i<data.length;i+=4)if(data[i]<100&&data[i+1]<100&&data[i+2]<100&&data[i+3]>200)points.push({x:(i/4)%300,y:Math.floor(i/4/300)});
 assert(points.length>10,`C05 glyph mask requires visible complete ink; count=${points.length}`);
 const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));
 return {x,y,points:new Set(points.map(p=>`${p.x-x}:${p.y-y}`)),width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y};
}
/** Bounded geometry only: never prints raster bytes, label text or credentials. */
export function glyphBounds(data){const {x,y,width,height,points}=glyphMask(data);return {x,y,width,height,count:points.size};}
export function glyphProof(actual,expected){
 const a=glyphMask(actual),e=glyphMask(expected);
 const summary=JSON.stringify({actual:{x:a.x,y:a.y,width:a.width,height:a.height,count:a.points.size},expected:{x:e.x,y:e.y,width:e.width,height:e.height,count:e.points.size},delta:{x:a.x-e.x,y:a.y-e.y,width:a.width-e.width,height:a.height-e.height}});
 assert(Math.abs(a.width-e.width)<=2,`C05 glyph width: ${summary}`);assert(Math.abs(a.height-e.height)<=2,`C05 glyph height: ${summary}`);
 assert(Math.abs(a.x-e.x)<=4,`C05 glyph horizontal anchor: ${summary}`);assert(Math.abs(a.y-e.y)<=4,`C05 glyph vertical anchor: ${summary}`);
 const overlap=[...a.points].filter(point=>e.points.has(point)).length;assert(overlap/Math.max(a.points.size,e.points.size)>.65,`C05 glyph shape overlap=${overlap/Math.max(a.points.size,e.points.size)}: ${summary}`);
}

export function strokeProof(samples,expectedWidth){
 assert(Number.isFinite(expectedWidth)&&expectedWidth>=2);
 assert(samples.length>0);for(let i=0;i<samples.length;i++){assert(Number.isFinite(samples[i].offset));assert.equal(typeof samples[i].ink,'boolean');if(i>0)assert(samples[i].offset>samples[i-1].offset);}
 const ink=samples.filter(sample=>sample.ink);assert(ink.some(sample=>Math.abs(sample.offset)<=1));
 assert(Math.abs(ink.length-expectedWidth)<=1.5,`C05 stroke width: ${JSON.stringify({inkLength:ink.length,expectedWidth,delta:ink.length-expectedWidth,firstInkOffset:ink[0]?.offset,lastInkOffset:ink.at(-1)?.offset})}`);
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

/** Independent reference for the versioned endpoint storage contract. No product decoder. */
export function connectorStorageReference(storage){
 const record=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
 assert(record(storage)&&record(storage.connector),'C05 reference requires a connector fallback');
 const result=structuredClone(storage.connector);
 const point=value=>record(value)&&Object.keys(value).every(key=>key==='x'||key==='y')&&Number.isFinite(value.x)&&Number.isFinite(value.y);
 for(const [side,slot] of [['from','connectorFrom'],['to','connectorTo']]){
  const names=[side,`${side}Point`,`${side}Anchor`,`${side}Offset`];
  if(Object.hasOwn(storage,slot)){
   const endpoint=storage[slot];
   assert(record(endpoint)&&Object.keys(endpoint).every(key=>names.includes(key)),'C05 reference rejects malformed endpoint slot');
   for(const key of names)delete result[key];
   Object.assign(result,structuredClone(endpoint));
  }
  const attached=result[side],free=result[`${side}Point`],offset=result[`${side}Offset`],anchor=result[`${side}Anchor`];
  assert((typeof attached==='string'&&attached.length>0)!==Boolean(free),'C05 reference requires exactly one endpoint identity');
  if(free!==undefined)assert(point(free),'C05 reference requires finite free endpoint');
  if(offset!==undefined)assert(attached&&point(offset),'C05 reference offset requires attached endpoint');
  if(anchor!==undefined)assert(['top','right','bottom','left','center'].includes(anchor),'C05 reference rejects invalid anchor');
 }
 return result;
}

/** Only explicitly marked Next navigation prefetch cancellations are non-errors. */
export function navigationPrefetchAbort({method,pathname,errorText,prefetch,knownProjectPath,knownNavigationPaths}){
 if(method!=='GET'||errorText!=='net::ERR_ABORTED'||prefetch!=='1')return false;
 // An allowlist excludes every Board, API, script, asset and unknown resource.
 // Critical resources remain failures even if mistakenly present in trusted navigation input.
 if(/^\/(?:api|whiteboards|_next|assets|uploads)(?:\/|$)/.test(pathname)||/^\/studio\/board(?:\/|$)/.test(pathname)||/\.(?:js|mjs|css|png|jpg|svg|woff2?|pdf)$/i.test(pathname))return false;
 if(typeof knownProjectPath==='string'&&/^\/projects\/[^/]+$/.test(knownProjectPath)&&pathname===knownProjectPath)return true;
 if(/^\/projects\//.test(pathname))return false;
 return Array.isArray(knownNavigationPaths)&&knownNavigationPaths.includes(pathname);

}

/** Compare the actual full-opacity raster to an independently drawn nominal-width reference. */
export function strokeRasterProof(actual,reference,integral){
 assert.equal(actual.length,reference.length);assert(actual.length>0);
 const referenceWidth=reference.filter(sample=>sample.ink).length;
 // Preserve the 1.5px count bound, continuity and exterior rejection. The
 // expected full-ink core comes from nominal native rasterization, never actual.
 strokeProof(reference,referenceWidth);strokeProof(actual,referenceWidth);
 let disagreement=0,actualCoverage=0,referenceCoverage=0;
 for(let index=0;index<actual.length;index++){
  assert.equal(actual[index].offset,reference[index].offset);
  for(const sample of [actual[index],reference[index]])assert(Number.isFinite(sample.coverage)&&sample.coverage>=0&&sample.coverage<=1,'C05 reference requires physical coverage');
  actualCoverage+=actual[index].coverage;referenceCoverage+=reference[index].coverage;
  if(actual[index].ink!==reference[index].ink)disagreement++;
 }
 if(integral){
  assert.equal(integral.step,.25);assert(Number.isFinite(integral.actual)&&Number.isFinite(integral.reference)&&integral.actual>=0&&integral.reference>=0);
  actualCoverage=integral.actual;referenceCoverage=integral.reference;
 }
 assert(Math.abs(actualCoverage-referenceCoverage)<=1.5,`C05 stroke coverage width: ${JSON.stringify({actualCoverage,referenceCoverage,step:integral?.step??1,delta:actualCoverage-referenceCoverage})}`);
 assert(disagreement<=1.5,`C05 stroke raster offsets disagree: ${JSON.stringify({disagreement,actualInk:actual.filter(sample=>sample.ink).length,referenceInk:referenceWidth})}`);
}

export function benignHomeNavigationCancellation({method,pathname,errorText,rsc,prefetch,proof,boardPath}){
 return method==='GET'&&pathname==='/home'&&errorText==='net::ERR_ABORTED'&&rsc===true&&prefetch===false
  &&typeof boardPath==='string'&&/^\/studio\/board\/[^/]+$/.test(boardPath)
  &&proof?.sourcePath==='/home'&&proof.destinationPath===boardPath&&proof.sameMainFrame===true&&proof.activeBeforeNavigation===true;
}

export function successfulHomeReplacement({sourcePath,start,cancel,status,replacementStart,replacementFinish,replacementStatus,firstHomeObserved}){
 return sourcePath==='/login'&&Number.isSafeInteger(start)&&Number.isSafeInteger(cancel)&&cancel>start
  &&(status===undefined||(status>=200&&status<300))
  &&Number.isSafeInteger(replacementStart)&&replacementStart>start
  &&Number.isSafeInteger(replacementFinish)&&replacementFinish>cancel&&replacementFinish>replacementStart
  &&replacementStatus>=200&&replacementStatus<300
  &&Number.isSafeInteger(firstHomeObserved)&&firstHomeObserved>cancel&&firstHomeObserved>=replacementStart;
}

export function successfulHomeDocumentNavigation(proof){
 const {sourcePath,start,cancel,status,documentStart,documentFinish,documentStatus,documentSourcePath,document,firstHomeObserved,sameOriginMainFrame,pathname}=proof;
 return pathname==='/home'&&sourcePath==='/login'&&documentSourcePath==='/login'&&document===true&&sameOriginMainFrame===true
  &&(status===undefined||(status>=200&&status<300))&&documentStatus>=200&&documentStatus<300
  &&[start,cancel,documentStart,documentFinish,firstHomeObserved].every(Number.isSafeInteger)
  &&documentStart<=start&&start<cancel&&cancel<documentFinish
  &&start<firstHomeObserved&&documentStart<=firstHomeObserved&&firstHomeObserved<=documentFinish;
}
