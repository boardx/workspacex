import {Worker} from 'node:worker_threads';
import {createRequire} from 'node:module';
import {STANDARD_WEB_LIMITS as L} from '@repo/contracts/standard-web-tools';
const require=createRequire(import.meta.url);
let activeParsers=0;
/** Readability runs away from the API event loop; DOM never executes scripts or loads resources. */
export async function extractStandardWebHtml(html:string,url:string):Promise<{title:string;text:string}> {
 if(activeParsers>=L.maxParseWorkers)throw new Error('standard_web_parser_busy');
 activeParsers++;let worker:Worker|undefined;
 try{return await new Promise<{title:string;text:string}>((resolve,reject)=>{
  worker=new Worker(`const {parentPort,workerData:d}=require('node:worker_threads');
   try {const {JSDOM}=require(d.jsdom);const {Readability}=require(d.readability);
   const dom=new JSDOM(d.html,{url:d.url});
   try {const article=new Readability(dom.window.document,{maxElemsToParse:d.maxElements,disableJSONLD:true}).parse();
   if(!article||!article.textContent.trim())throw new Error();
   parentPort.postMessage({title:article.title||'',text:article.textContent});}finally{dom.window.close();}}
   catch{parentPort.postMessage({error:true});}`,{eval:true,workerData:{html,url,maxElements:L.maxElements,jsdom:require.resolve('jsdom'),readability:require.resolve('@mozilla/readability')},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:32}});
  const timer=setTimeout(()=>reject(new Error('standard_web_parse_timeout')),L.parseDeadlineMs);
  worker.once('message',v=>{clearTimeout(timer);if(v.error)reject(new Error('standard_web_extract_failed'));else resolve(v);});
  worker.once('error',()=>{clearTimeout(timer);reject(new Error('standard_web_extract_failed'));});
  worker.once('exit',()=>{clearTimeout(timer);reject(new Error('standard_web_extract_failed'));});
 });}finally{try{await worker?.terminate();}finally{activeParsers--;}}
}
