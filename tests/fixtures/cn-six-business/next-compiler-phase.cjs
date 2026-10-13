'use strict';
const {performance}=require('node:perf_hooks');
const TAG='__wsxNextCompilerPhase',PHASES=['finishModules','seal','afterCompile','afterEmit','afterDone'];
const FIELDS=['rssBytes','heapTotalBytes','heapUsedBytes','externalBytes','arrayBuffersBytes'];
const NAMES={client:1,server:2,'edge-server':3},MAX_EVENTS=8,MAX_EMPTY=64,MAX_COMPILATIONS=16;
const MILESTONES=[1,256,512,1024,2048,4096,8192,16384],actors=new WeakMap();
function plugin(name,actor=process,now=()=>performance.now()){
 const index=Object.hasOwn(NAMES,name)?NAMES[name]:null;if(!Number.isInteger(index)||index<1||index>3)return null;
 let state=actors.get(actor);if(!state){state={instances:0,counts:[0,0,0],empty:[0,0,0],compilations:[0,0,0],builds:[0,0,0],closed:[false,false,false],origin:now()};actors.set(actor,state);}
 if(state.instances>=6)return null;state.instances++;
 const slot=index-1,origin=state.origin;let applied=false;
 const active=()=>!state.closed[slot]&&actor.connected&&state.counts[slot]<MAX_EVENTS;
 return {apply(compiler){
  if(applied)return;applied=true;
  const observe=(phase,value)=>{
   if(!active())return;
   try{
    const modules=phase===1?value:phase===5?value?.compilation?.modules:value?.modules;
    const size=modules?.size,available=Number.isSafeInteger(size)&&size>=0;
    if(phase!==6&&available&&size===0){state.empty[slot]++;if(state.empty[slot]>=MAX_EMPTY)state.closed[slot]=true;return;}
    const m=actor.memoryUsage();
    actor.send({[TAG]:1,pid:actor.pid,compiler:index,event:++state.counts[slot],phase,elapsedMilliseconds:Math.floor(now()-origin),moduleCountAvailable:available?1:0,moduleCount:available?size:0,buildModuleCallbacks:state.builds[slot],emptyEventsSkipped:state.empty[slot],rssBytes:m.rss,heapTotalBytes:m.heapTotal,heapUsedBytes:m.heapUsed,externalBytes:m.external,arrayBuffersBytes:m.arrayBuffers},()=>{});
   }catch{state.closed[slot]=true;}
  };
  compiler.hooks.thisCompilation.tap('CnBoundedCompilerPhase',compilation=>{
   if(!active())return;if(++state.compilations[slot]>MAX_COMPILATIONS){state.closed[slot]=true;return;}
   compilation.hooks.buildModule.tap('CnBoundedCompilerPhase',()=>{
    if(!active()||state.builds[slot]>=16384)return;
    const count=++state.builds[slot];if(MILESTONES.includes(count))observe(6,compilation);
   });
   compilation.hooks.finishModules.tap('CnBoundedCompilerPhase',modules=>observe(1,modules));
   compilation.hooks.seal.tap('CnBoundedCompilerPhase',()=>observe(2,compilation));
  });
  for(const [i,phase] of PHASES.entries())if(i>=2)compiler.hooks[phase].tap('CnBoundedCompilerPhase',value=>observe(i+1,value));
 }};
}
function collect(child){
 const events=[],counts=[0,0,0],times=[0,0,0],builds=[0,0,0],empty=[0,0,0];let rejected=0;
 child.on('message',m=>{
  if(!m||typeof m!=='object'||m[TAG]!==1)return;
  const keys=[TAG,'pid','compiler','event','phase','elapsedMilliseconds','moduleCountAvailable','moduleCount','buildModuleCallbacks','emptyEventsSkipped',...FIELDS];
  if(Object.keys(m).length!==keys.length||!keys.every(k=>Number.isSafeInteger(m[k])&&m[k]>=0)||m.pid!==child.pid||m.compiler<1||m.compiler>3||m.phase<1||m.phase>6||m.moduleCountAvailable>1||(!m.moduleCountAvailable&&m.moduleCount!==0)||m.event!==counts[m.compiler-1]+1||m.event>MAX_EVENTS||m.elapsedMilliseconds<times[m.compiler-1]||m.buildModuleCallbacks<builds[m.compiler-1]||m.buildModuleCallbacks>16384||m.emptyEventsSkipped<empty[m.compiler-1]||m.emptyEventsSkipped>=MAX_EMPTY||(m.phase===6&&(!MILESTONES.includes(m.buildModuleCallbacks)||m.buildModuleCallbacks===builds[m.compiler-1]))){rejected=Math.min(24,rejected+1);return;}
  const slot=m.compiler-1;counts[slot]++;times[slot]=m.elapsedMilliseconds;builds[slot]=m.buildModuleCallbacks;empty[slot]=m.emptyEventsSkipped;
  events.push(Object.fromEntries(keys.filter(k=>k!==TAG).map(k=>[k,m[k]])));
 });
 return()=>({available:events.length>0,maxEventsPerCompiler:MAX_EVENTS,maxCompilers:3,maxEmptyEventsPerCompiler:MAX_EMPTY,maxCompilationsPerCompiler:MAX_COMPILATIONS,rejectedEvents:rejected,events});
}
module.exports={plugin,collect,TAG,PHASES,MILESTONES};
