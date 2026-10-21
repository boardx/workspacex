import {Worker} from 'node:worker_threads';
import {createRequire} from 'node:module';
import {STANDARD_WEB_LIMITS as L} from '@repo/contracts/standard-web-tools';
const require=createRequire(import.meta.url);
let activeParsers=0;
/**
 * Readability runs in a bounded worker using Domino's inert, dependency-free DOM.
 * It neither executes document scripts nor loads resources. Keep the canvas
 * resolution guard as defense in depth, without shipping its native peer chain.
 */
export async function extractStandardWebHtml(html:string,url:string):Promise<{title:string;text:string;canvasBlocked:boolean}> {
 if(activeParsers>=L.maxParseWorkers)throw new Error('standard_web_parser_busy');
 activeParsers++;let worker:Worker|undefined;
 try{return await new Promise<{title:string;text:string;canvasBlocked:boolean}>((resolve,reject)=>{
  worker=new Worker(`const {parentPort,workerData:d}=require('node:worker_threads');
   const Module=require('node:module');
   const origResolveFilename=Module._resolveFilename;
   Module._resolveFilename=function(request,...rest){
    if(request==='canvas'){const e=new Error("Cannot find module 'canvas'");e.code='MODULE_NOT_FOUND';throw e;}
    return origResolveFilename.call(this,request,...rest);
   };
   try {const domino=require(d.domino);const {Readability}=require(d.readability);
   let canvasBlocked=false;try{require('canvas');}catch(e){canvasBlocked=e.code==='MODULE_NOT_FOUND';}
   const document=domino.createWindow(d.html,d.url).document;
   // Domino implements DOM4 collections without ES iteration. Readability 0.6 uses for-of.
   for(const list of [document.getElementsByTagName('body'),document.querySelectorAll('body'),document.childNodes]){
    const prototype=Object.getPrototypeOf(list);if(!prototype[Symbol.iterator])Object.defineProperty(prototype,Symbol.iterator,{value:Array.prototype[Symbol.iterator]});
   }
   let base=d.url;try{const element=document.querySelector('base[href]');if(element)base=new URL(element.getAttribute('href'),d.url).href;}catch{}
   Object.defineProperty(document,'baseURI',{value:base});Object.defineProperty(document,'documentURI',{value:d.url});
   const article=new Readability(document,{maxElemsToParse:d.maxElements,disableJSONLD:true}).parse();
   if(!article||!article.textContent.trim())throw new Error();
   parentPort.postMessage({title:article.title||'',text:article.textContent,canvasBlocked});}
   catch{parentPort.postMessage({error:true});}`,{eval:true,workerData:{html,url,maxElements:L.maxElements,domino:require.resolve('domino'),readability:require.resolve('@mozilla/readability')},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:32}});
  const timer=setTimeout(()=>reject(new Error('standard_web_parse_timeout')),L.parseDeadlineMs);
  worker.once('message',v=>{clearTimeout(timer);if(v.error)reject(new Error('standard_web_extract_failed'));else resolve(v);});
  worker.once('error',()=>{clearTimeout(timer);reject(new Error('standard_web_extract_failed'));});
  worker.once('exit',()=>{clearTimeout(timer);reject(new Error('standard_web_extract_failed'));});
 });}finally{try{await worker?.terminate();}finally{activeParsers--;}}
}
