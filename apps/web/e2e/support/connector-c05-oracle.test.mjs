import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {independentProcessIds,cubicSamples} from './connector-c05-oracle.mjs';
test('distinct positive browser PIDs are required, not repeated contexts',()=>{
 assert.deepEqual(independentProcessIds([100,200,300]),[100,200,300]);
 for(const ids of [[100,100,300],[100,200],[-1,200,300],[NaN,200,300]])assert.throws(()=>independentProcessIds(ids));
});
test('independent cubic measurements match a known straight polynomial',()=>{
 const samples=cubicSamples({x:0,y:0},{x:300,y:0},{kind:'curve',startOffset:{x:100,y:0},endOffset:{x:-100,y:0}});
 samples.forEach((point,index)=>{assert(Math.abs(point.x-[36,105,240][index])<1e-10);assert.equal(point.y,0);});
});
test('changed control offsets change real samples and nonfinite measurements reject',()=>{
 const route={kind:'curve',startOffset:{x:100,y:0},endOffset:{x:-100,y:0}};
 const before=cubicSamples({x:0,y:0},{x:300,y:0},route);
 const after=cubicSamples({x:0,y:0},{x:300,y:0},{...route,startOffset:{x:100,y:80}});
 assert(after.every((point,index)=>point.y>before[index].y));
 assert.throws(()=>cubicSamples({x:NaN,y:0},{x:300,y:0},route));
 assert.throws(()=>cubicSamples({x:0,y:0},{x:300,y:0},{...route,kind:'elbow'}));
});
test('gesture proof rejects missing ACK wrong actor epoch and lost concurrent write',async()=>{
 const {acceptedGesture}=await import('./connector-c05-oracle.mjs');
 const before={epoch:2,seq:9},after={epoch:2,seq:11};
 const submitted=[{process:0,updateId:'a',gestureId:'ga',epoch:2},{process:1,updateId:'b',gestureId:'gb',epoch:2}];
 const acks=[{process:0,updateId:'a',gestureId:'ga',seq:10},{process:1,updateId:'b',gestureId:'gb',seq:11}];
 acceptedGesture(before,after,submitted,acks,[0,1]);
 assert.throws(()=>acceptedGesture(before,after,submitted,acks.slice(0,1),[0,1]));
 assert.throws(()=>acceptedGesture(before,after,submitted,[acks[0],{...acks[1],process:2}],[0,1]));
 assert.throws(()=>acceptedGesture(before,{...after,epoch:3},submitted,acks,[0,1]));
 assert.throws(()=>acceptedGesture(before,{...after,seq:10},submitted,acks,[0,1]));
 assert.throws(()=>acceptedGesture(before,after,submitted.map(update=>({...update,updateId:undefined,gestureId:undefined})),acks.map(ack=>({...ack,updateId:undefined,gestureId:undefined})),[0,1]));
 assert.throws(()=>acceptedGesture(before,after,[...submitted,{...submitted[0],process:2}],acks,[0,1]));
});
test('local Connector oracle rejects width label route position or endpoint loss',async()=>{
 const {retainedConnector}=await import('./connector-c05-oracle.mjs');
 const expected={strokeWidth:8,label:'C05',route:{kind:'curve',startOffset:{x:1,y:2}},labelPosition:{t:.6,normalOffset:20},fromPoint:{x:1,y:2},toPoint:{x:3,y:4},fromAnchor:'right',toAnchor:'left',semanticRelation:'depends_on',startStyle:'none',endStyle:'none',lineStyle:'solid',type:'curve'};
 retainedConnector(expected,{...expected});
 for(const field of Object.keys(expected)){const broken={...expected};delete broken[field];assert.throws(()=>retainedConnector(expected,broken));}
 assert.throws(()=>retainedConnector(expected,{...expected,from:'stale-attached-node'}));
});
test('arc-length label measurement uses independent straight-line normal and nearest position',async()=>{
 const {curveMeasurement}=await import('./connector-c05-oracle.mjs');
 const measured=curveMeasurement({x:0,y:0},{x:300,y:0},{kind:'curve',startOffset:{x:100,y:0},endOffset:{x:-100,y:0}},{t:.5,normalOffset:20},{x:210,y:45});
 assert(Math.abs(measured.point.x-150)<1e-8);assert.equal(measured.point.y,20);
 assert(Math.abs(measured.t-.7)<1e-8);assert.equal(measured.normalOffset,45);
});
test('glyph oracle rejects blank red-only and a stale differently shaped label',async()=>{
 const {glyphProof}=await import('./connector-c05-oracle.mjs');
 const image=()=>Array(300*60*4).fill(255),expected=image();
 for(let y=10;y<20;y++)for(let x=10;x<30;x++){const i=(y*300+x)*4;expected[i]=expected[i+1]=expected[i+2]=0;}
 glyphProof(expected,expected);assert.throws(()=>glyphProof(image(),expected));
 const red=image();for(let i=0;i<red.length;i+=4){red[i]=225;red[i+1]=29;red[i+2]=72;}assert.throws(()=>glyphProof(red,expected));
 const stale=image();for(let y=10;y<20;y++)for(let x=10;x<20;x++){const i=(y*300+x)*4;stale[i]=stale[i+1]=stale[i+2]=0;}assert.throws(()=>glyphProof(stale,expected));
 const shifted=image();for(let y=10;y<20;y++)for(let x=20;x<40;x++){const i=(y*300+x)*4;shifted[i]=shifted[i+1]=shifted[i+2]=0;}assert.throws(()=>glyphProof(shifted,expected));
});
test('stroke oracle rejects a thin four-to-two line and shifted or disconnected ink',async()=>{
 const {strokeProof}=await import('./connector-c05-oracle.mjs');
 const scan=(points)=>Array.from({length:21},(_,i)=>({offset:i-10,ink:points.includes(i-10)}));
 strokeProof(scan([-2,-1,0,1]),4);
 assert.throws(()=>strokeProof(scan([-1,0]),4));
 assert.throws(()=>strokeProof(scan([4,5,6,7]),4));
 assert.throws(()=>strokeProof(scan([-2,0,1,2]),4));
 assert.throws(()=>strokeProof([{offset:0,ink:true},{offset:0,ink:true}],2));
 assert.throws(()=>strokeProof([{offset:NaN,ink:true}],2));
});
