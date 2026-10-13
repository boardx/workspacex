'use strict';
const {performance}=require('node:perf_hooks');
const TAG='__wsxNextCompilerPhase',PHASES=['finishModules','seal','afterCompile','afterEmit','afterDone'];
const FIELDS=['rssBytes','heapTotalBytes','heapUsedBytes','externalBytes','arrayBuffersBytes'];
const NAMES={client:1,server:2,'edge-server':3},MAX_EVENTS=8,MAX_SMALL=64,MAX_COMPILATIONS=16;
const MILESTONES=[1,512,1024,2048,4096,8192],actors=new WeakMap();
// Fixed positions: mermaid, fabric-markdown, copilotkit, monaco, codemirror,
// mui, other third-party, other local, unknown. Never retain resource text.
function packageBucket(module){
 try{
  const raw=Object.getOwnPropertyDescriptor(module,'resource')?.value;
  if(typeof raw!=='string'||raw.length>4096||/[\0\r\n]/.test(raw))return 8;
  const resource=raw.replace(/\\/g,'/').split('?')[0];
  if(!/^(?:\/|[A-Za-z]:\/)/.test(resource))return 8;
  if(resource.includes('!'))return 8;
  const offset=resource.lastIndexOf('/node_modules/');
  if(offset>=0){
   const packagePath=resource.slice(offset+'/node_modules/'.length);
   if(packagePath.startsWith('mermaid/'))return 0;
   if(packagePath.startsWith('@repo/fabric-markdown/'))return 1;
   if(packagePath.startsWith('@copilotkit/'))return 2;
   if(packagePath.startsWith('monaco-editor/')||packagePath.startsWith('@monaco-editor/'))return 3;
   if(packagePath.startsWith('codemirror/')||packagePath.startsWith('@codemirror/'))return 4;
   if(packagePath.startsWith('@mui/'))return 5;
   return packagePath?6:8;
  }
  return resource.includes('/packages/fabric-markdown/')?1:7;
 }catch{return 8;}
}
function plugin(name,actor=process,now=()=>performance.now()){
 const index=Object.hasOwn(NAMES,name)?NAMES[name]:null;if(!Number.isInteger(index)||index<1||index>3)return null;
 let state=actors.get(actor);if(!state){state={instances:0,counts:[0,0,0],small:[0,0,0],buildEvents:[0,0,0],completed:[new Set(),new Set(),new Set()],compilations:[0,0,0],builds:[0,0,0],packages:[Array(9).fill(0),Array(9).fill(0),Array(9).fill(0)],closed:[false,false,false],origin:now()};actors.set(actor,state);}
 if(state.instances>=6)return null;state.instances++;
 const slot=index-1,origin=state.origin;let applied=false;
 const active=()=>!state.closed[slot]&&actor.connected&&state.counts[slot]<MAX_EVENTS;
 return {apply(compiler){
  if(applied)return;applied=true;
  const observe=(phase,value)=>{
   if(!active()||![3,5,6].includes(phase))return;
   if(phase===6&&state.buildEvents[slot]>=6)return;
   if(phase!==6&&state.completed[slot].has(phase))return;
   try{
    const modules=phase===1?value:phase===5?value?.compilation?.modules:value?.modules;
    const size=modules?.size,available=Number.isSafeInteger(size)&&size>=0;
    if(phase!==6&&(!available||size<1024)){state.small[slot]++;if(state.small[slot]>=MAX_SMALL)state.closed[slot]=true;return;}
    if(phase===6)state.buildEvents[slot]++;else state.completed[slot].add(phase);
    const m=actor.memoryUsage();
    actor.send({[TAG]:1,pid:actor.pid,compiler:index,event:++state.counts[slot],phase,elapsedMilliseconds:Math.floor(now()-origin),moduleCountAvailable:available?1:0,moduleCount:available?size:0,buildModuleCallbacks:state.builds[slot],smallCompletionEventsSkipped:state.small[slot],packageCallbackCounts:[...state.packages[slot]],rssBytes:m.rss,heapTotalBytes:m.heapTotal,heapUsedBytes:m.heapUsed,externalBytes:m.external,arrayBuffersBytes:m.arrayBuffers},()=>{});
   }catch{state.closed[slot]=true;}
  };
  compiler.hooks.thisCompilation.tap('CnBoundedCompilerPhase',compilation=>{
   if(!active())return;if(++state.compilations[slot]>MAX_COMPILATIONS){state.closed[slot]=true;return;}
   compilation.hooks.buildModule.tap('CnBoundedCompilerPhase',module=>{
    if(!active()||state.builds[slot]>=16384)return;
    state.packages[slot][packageBucket(module)]++;
    const count=++state.builds[slot];if(MILESTONES.includes(count))observe(6,compilation);
   });
  });
  for(const [i,phase] of PHASES.entries())if(i===2||i===4)compiler.hooks[phase].tap('CnBoundedCompilerPhase',value=>observe(i+1,value));
 }};
}
function collect(child){
 const events=[],counts=[0,0,0],times=[0,0,0],builds=[0,0,0],small=[0,0,0],buildEvents=[0,0,0],packages=[Array(9).fill(0),Array(9).fill(0),Array(9).fill(0)],completed=[new Set(),new Set(),new Set()];let rejected=0;
 child.on('message',m=>{
  if(!m||typeof m!=='object'||m[TAG]!==1)return;
  const keys=[TAG,'pid','compiler','event','phase','elapsedMilliseconds','moduleCountAvailable','moduleCount','buildModuleCallbacks','smallCompletionEventsSkipped',...FIELDS];
  if(Object.keys(m).length!==keys.length+1||!keys.every(k=>Number.isSafeInteger(m[k])&&m[k]>=0)||!Array.isArray(m.packageCallbackCounts)||m.packageCallbackCounts.length!==9||!Array.from(m.packageCallbackCounts).every((v,i)=>Number.isSafeInteger(v)&&v>=0&&v<=16384&&v>=(packages[m.compiler-1]?.[i]??0))||m.packageCallbackCounts.reduce((a,b)=>a+b,0)!==m.buildModuleCallbacks||m.pid!==child.pid||m.compiler<1||m.compiler>3||![3,5,6].includes(m.phase)||m.moduleCountAvailable>1||(!m.moduleCountAvailable&&m.moduleCount!==0)||m.event!==counts[m.compiler-1]+1||m.event>MAX_EVENTS||m.elapsedMilliseconds<times[m.compiler-1]||m.buildModuleCallbacks<builds[m.compiler-1]||m.buildModuleCallbacks>16384||m.smallCompletionEventsSkipped<small[m.compiler-1]||m.smallCompletionEventsSkipped>=MAX_SMALL||(m.phase===6&&(buildEvents[m.compiler-1]>=6||m.buildModuleCallbacks!==MILESTONES[buildEvents[m.compiler-1]]))||(m.phase!==6&&(!m.moduleCountAvailable||m.moduleCount<1024||completed[m.compiler-1].has(m.phase)))){rejected=Math.min(24,rejected+1);return;}
  const slot=m.compiler-1;counts[slot]++;times[slot]=m.elapsedMilliseconds;builds[slot]=m.buildModuleCallbacks;small[slot]=m.smallCompletionEventsSkipped;packages[slot]=[...m.packageCallbackCounts];if(m.phase===6)buildEvents[slot]++;else completed[slot].add(m.phase);
  events.push({...Object.fromEntries(keys.filter(k=>k!==TAG).map(k=>[k,m[k]])),packageCallbackCounts:[...m.packageCallbackCounts]});
 });
 return()=>({available:events.length>0,maxEventsPerCompiler:MAX_EVENTS,maxCompilers:3,maxBuildEventsPerCompiler:6,maxBuildModuleCallbacks:16384,maxCompletionEventsPerCompiler:2,maxSmallCompletionEventsPerCompiler:MAX_SMALL,maxCompilationsPerCompiler:MAX_COMPILATIONS,rejectedEvents:rejected,events});
}
module.exports={plugin,collect,packageBucket,TAG,PHASES,MILESTONES};
