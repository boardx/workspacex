'use strict';
const {performance}=require('node:perf_hooks');
const TAG='__wsxNextMemoryObserver',INTERVAL_MS=5000,MAX_SAMPLES=120;
const FIELDS=['rssBytes','heapTotalBytes','heapUsedBytes','externalBytes','arrayBuffersBytes'];
function startSampler(actor=process,timers=globalThis,now=()=>performance.now()){
 let timer=null,count=0,closed=false;const origin=now();
 const stop=()=>{closed=true;if(timer!==null)timers.clearInterval(timer);};
 const emit=()=>{
  if(closed||!actor.connected||count>=MAX_SAMPLES){stop();return;}
  try{const m=actor.memoryUsage();actor.send({[TAG]:1,pid:actor.pid,sample:++count,elapsedMilliseconds:Math.floor(now()-origin),rssBytes:m.rss,heapTotalBytes:m.heapTotal,heapUsedBytes:m.heapUsed,externalBytes:m.external,arrayBuffersBytes:m.arrayBuffers},()=>{});}catch{stop();}
  if(count>=MAX_SAMPLES)stop();
 };
 actor.once('disconnect',stop);actor.once('exit',stop);emit();
 if(!closed){timer=timers.setInterval(emit,INTERVAL_MS);timer.unref();}
 return stop;
}
function collect(child){
 let count=0,rejected=0,last=null,peaks=null;
 child.on('message',message=>{
  try{
   if(!message||typeof message!=='object'||message[TAG]!==1)return;
   const keys=[TAG,'pid','sample','elapsedMilliseconds',...FIELDS];
   if(Object.keys(message).length!==keys.length||!keys.every(k=>Number.isSafeInteger(message[k])&&message[k]>=0)||message.pid!==child.pid||message.sample!==count+1||message.sample>MAX_SAMPLES||(last&&message.elapsedMilliseconds-last.elapsedMilliseconds<4000))throw Error('BAD_SAMPLE');
   last=Object.fromEntries(keys.filter(k=>k!==TAG).map(k=>[k,message[k]]));count++;
   peaks=Object.fromEntries(FIELDS.map(k=>[k,Math.max(peaks?.[k]??0,message[k])]));
  }catch{rejected=Math.min(MAX_SAMPLES,rejected+1);}
 });
 return()=>({observedSamples:count,rejectedSamples:rejected,maxSamples:MAX_SAMPLES,intervalMilliseconds:INTERVAL_MS,capReached:count===MAX_SAMPLES,latest:last,observedPeaks:peaks});
}
module.exports={startSampler,collect,TAG,INTERVAL_MS,MAX_SAMPLES};
