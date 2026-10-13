'use strict';
// Fixed ASCII allowlist, bounded state across arbitrary chunk boundaries.
function classifier(){
 const words=['FATAL ERROR:','JavaScript heap out of memory'],states=[0,0],counts=[0,0];
 return {feed(bytes){for(const byte of bytes)for(let i=0;i<words.length;i++){
  const word=words[i];if(byte===word.charCodeAt(states[i]))states[i]++;else states[i]=byte===word.charCodeAt(0)?1:0;
  if(states[i]===word.length){counts[i]=Math.min(1000000,counts[i]+1);states[i]=0;}
 }},snapshot(){return {jsHeapOom:counts[1]>0,otherFatal:counts[0]>0&&counts[1]===0,unknown:counts[0]===0&&counts[1]===0,fatalMarkerCount:counts[0],jsHeapOomMarkerCount:counts[1]};}};
}
module.exports={classifier};
