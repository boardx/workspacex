import {Worker} from 'node:worker_threads';
import {createRequire} from 'node:module';
import {STANDARD_WEB_LIMITS as L} from '@repo/contracts/standard-web-tools';
const require=createRequire(import.meta.url);
let activeParsers=0;
/**
 * Readability runs away from the API event loop; DOM never executes scripts or loads resources.
 * jsdom eagerly `require("canvas")`s itself at import time (see jsdom/lib/jsdom/utils.js) and only
 * falls back to a null Canvas on a clean MODULE_NOT_FOUND. `canvas` is a native N-API addon that we
 * never actually need for text extraction (no <canvas>/<img> rendering happens here) — and pnpm's
 * default auto-install-peers pulls it in workspace-wide as vitest's jsdom's optional peer, so it is
 * present in every install (see apps/api/package.json's canvas devDependency + pnpm-lock.yaml). If
 * that native binary is ABI/platform-mismatched (musl/Linux containers commonly lack libcairo etc.),
 * loading it inside a worker_thread can hard-abort the whole process with `FATAL ERROR: napi_throw`,
 * which try/catch cannot intercept. We block the `canvas` require at the Module-resolution level
 * before jsdom ever gets a chance to touch it, so jsdom degrades to its documented no-canvas mode.
 * `canvasBlocked` on the result is not consumed by any caller — it lets tests observe that the
 * guard is actually in effect on THIS worker script, instead of re-implementing the same patch
 * a second time and only proving the mechanism works in the abstract (issue #3439 附带发现).
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
   try {const {JSDOM}=require(d.jsdom);const {Readability}=require(d.readability);
   const canvasBlocked=require(d.jsdomUtils).Canvas===null;
   const dom=new JSDOM(d.html,{url:d.url});
   try {const article=new Readability(dom.window.document,{maxElemsToParse:d.maxElements,disableJSONLD:true}).parse();
   if(!article||!article.textContent.trim())throw new Error();
   parentPort.postMessage({title:article.title||'',text:article.textContent,canvasBlocked});}finally{dom.window.close();}}
   catch{parentPort.postMessage({error:true});}`,{eval:true,workerData:{html,url,maxElements:L.maxElements,jsdom:require.resolve('jsdom'),jsdomUtils:require.resolve('jsdom/lib/jsdom/utils.js'),readability:require.resolve('@mozilla/readability')},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:32}});
  const timer=setTimeout(()=>reject(new Error('standard_web_parse_timeout')),L.parseDeadlineMs);
  worker.once('message',v=>{clearTimeout(timer);if(v.error)reject(new Error('standard_web_extract_failed'));else resolve(v);});
  worker.once('error',()=>{clearTimeout(timer);reject(new Error('standard_web_extract_failed'));});
  worker.once('exit',()=>{clearTimeout(timer);reject(new Error('standard_web_extract_failed'));});
 });}finally{try{await worker?.terminate();}finally{activeParsers--;}}
}
