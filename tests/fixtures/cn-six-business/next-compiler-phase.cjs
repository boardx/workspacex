'use strict';
const {performance}=require('node:perf_hooks');
const TAG='__wsxNextCompilerPhase',PHASES=['finishModules','seal','afterCompile','afterEmit','afterDone'];
const FIELDS=['rssBytes','heapTotalBytes','heapUsedBytes','externalBytes','arrayBuffersBytes'];
const NAMES={client:1,server:2,'edge-server':3},MAX_EVENTS=8;
const actors=new WeakMap();
function plugin(name,actor=process,now=()=>performance.now()){
 const index=Object.hasOwn(NAMES,name)?NAMES[name]:null;if(!Number.isInteger(index)||index<1||index>3)return null;
 let state=actors.get(actor);if(!state){state={instances:0,counts:[0,0,0],origin:now()};actors.set(actor,state);}
 if(state.instances>=6)return null;state.instances++;
 let closed=false,applied=false;const origin=state.origin;
 return {apply(compiler){
  if(applied)return;applied=true;
  const observe=(i,phase)=>(value)=>{
   if(closed||!actor.connected||state.counts[index-1]>=MAX_EVENTS)return;
   try{
    const modules=phase==='finishModules'?value:phase==='afterDone'?value?.compilation?.modules:value?.modules;
    const size=modules?.size,available=Number.isSafeInteger(size)&&size>=0;
    const m=actor.memoryUsage();
    actor.send({[TAG]:1,pid:actor.pid,compiler:index,event:++state.counts[index-1],phase:i+1,elapsedMilliseconds:Math.floor(now()-origin),moduleCountAvailable:available?1:0,moduleCount:available?size:0,rssBytes:m.rss,heapTotalBytes:m.heapTotal,heapUsedBytes:m.heapUsed,externalBytes:m.external,arrayBuffersBytes:m.arrayBuffers},()=>{});
   }catch{closed=true;}
  };
  compiler.hooks.thisCompilation.tap('CnBoundedCompilerPhase',compilation=>{
   if(closed||state.counts[index-1]>=MAX_EVENTS)return;
   compilation.hooks.finishModules.tap('CnBoundedCompilerPhase',observe(0,'finishModules'));
   compilation.hooks.seal.tap('CnBoundedCompilerPhase',()=>observe(1,'seal')(compilation));
  });
  for(const [i,phase] of PHASES.entries())if(i>=2)compiler.hooks[phase].tap('CnBoundedCompilerPhase',observe(i,phase));
 }};
}
function collect(child){
 const events=[],counts=[0,0,0],times=[0,0,0];let rejected=0;
 child.on('message',m=>{
  if(!m||typeof m!=='object'||m[TAG]!==1)return;
  const keys=[TAG,'pid','compiler','event','phase','elapsedMilliseconds','moduleCountAvailable','moduleCount',...FIELDS];
  if(Object.keys(m).length!==keys.length||!keys.every(k=>Number.isSafeInteger(m[k])&&m[k]>=0)||m.pid!==child.pid||m.compiler<1||m.compiler>3||m.phase<1||m.phase>5||m.moduleCountAvailable>1||(!m.moduleCountAvailable&&m.moduleCount!==0)||m.event!==counts[m.compiler-1]+1||m.event>MAX_EVENTS||m.elapsedMilliseconds<times[m.compiler-1]){rejected=Math.min(24,rejected+1);return;}
  counts[m.compiler-1]++;times[m.compiler-1]=m.elapsedMilliseconds;
  events.push(Object.fromEntries(keys.filter(k=>k!==TAG).map(k=>[k,m[k]])));
 });
 return()=>({available:events.length>0,maxEventsPerCompiler:MAX_EVENTS,maxCompilers:3,rejectedEvents:rejected,events});
}
module.exports={plugin,collect,TAG,PHASES};
