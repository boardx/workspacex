import {Worker} from 'node:worker_threads';
import {createRequire} from 'node:module';
import {McpFrozenTool,McpInvokeOutput,McpRuntimeTool,MCP_EXECUTION_LIMITS as L} from '@repo/contracts/mcp-execution-snapshot';
import type {z} from 'zod';
export interface McpExecutionControl {signal:AbortSignal;deadlineAt?:number;receipt?:{orgId:string;runId:string;toolCallId:string;attemptId:string;leaseEpoch:number};}
export type McpExecutionCall=(tool:z.infer<typeof McpFrozenTool>,args:Record<string,unknown>,control?:McpExecutionControl)=>Promise<z.infer<typeof McpInvokeOutput>>;
/** Infrastructure-only TLS/DNS seams for real protocol tests, never accepted by an HTTP route. */
export interface McpExecutionOptions {extraTrustedCa?:string;timeoutMs?:number;testNetwork?:{lookupAddress:string;allowPrivateAddress?:boolean};}
const require=createRequire(import.meta.url);
let active=0;
const program=`
const {parentPort,workerData}=require('node:worker_threads');
(async()=>{
 const {tsImport}=require(workerData.loader);
 const {createHttpMcpExecutionCore,assertResolvedMcpAddressAllowed,validateMcpSchemas}=await tsImport(workerData.module,workerData.parent);
 if(workerData.schemas){validateMcpSchemas(workerData.schemas);parentPort.postMessage({result:{valid:true}});return;}
 const {options}=workerData;
 const seams=options.testNetwork?{
  lookup:(_host,opts,cb)=>opts?.all?cb(null,[{address:options.testNetwork.lookupAddress,family:4}]):cb(null,options.testNetwork.lookupAddress,4),
  checkAddress:options.testNetwork.allowPrivateAddress?()=>{}:assertResolvedMcpAddressAllowed
 }:undefined;
 const result=await createHttpMcpExecutionCore({extraTrustedCa:options.extraTrustedCa,timeoutMs:options.timeoutMs,seams,sealed:workerData.sealed})(workerData.tool,workerData.args);
 if(Buffer.byteLength(JSON.stringify(result))>workerData.maxBytes)throw Error('limit');
 parentPort.postMessage({result});
})().catch(()=>parentPort.postMessage({failed:true}));`;
async function runWorker(payload:Record<string,unknown>,options:McpExecutionOptions,signal?:AbortSignal):Promise<unknown>{
 if(signal?.aborted)throw new Error('mcp_execution_unconfirmed');
 if(active>=L.maxConcurrentExecutions)throw new Error('mcp_execution_unavailable');
 const timeout=Math.min(options.timeoutMs??L.deadlineMs,L.deadlineMs);
 if(!Number.isFinite(timeout)||timeout<=0)throw new Error('mcp_execution_unavailable');
 active++;
 let worker:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined;let onAbort:(()=>void)|undefined;
 try{
  worker=new Worker(program,{eval:true,workerData:{loader:require.resolve('tsx/esm/api'),module:new URL('./http-mcp-execution-core.ts',import.meta.url).href,parent:import.meta.url,...payload,options:{...options,timeoutMs:timeout},maxBytes:L.maxResultBytes},stdout:true,stderr:true,resourceLimits:{maxOldGenerationSizeMb:L.workerHeapMb}});
  worker.stdout.resume();worker.stderr.resume();
  const result=await new Promise<unknown>((resolve,reject)=>{
   onAbort=()=>reject(new Error('mcp_execution_unconfirmed'));signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();
   timer=setTimeout(()=>reject(new Error('mcp_execution_unconfirmed')),timeout);
   worker!.once('message',(message:unknown)=>{if(!message||typeof message!=='object'||!('result'in message))reject(new Error('mcp_execution_unconfirmed'));else resolve(message.result);});
   worker!.once('error',()=>reject(new Error('mcp_execution_unconfirmed')));
   worker!.once('exit',()=>reject(new Error('mcp_execution_unconfirmed')));
  });
  if(Buffer.byteLength(JSON.stringify(result))>L.maxResultBytes)throw new Error('mcp_execution_unconfirmed');
  return result;
 }catch{throw new Error('mcp_execution_unconfirmed');}
 finally{if(onAbort)signal?.removeEventListener('abort',onAbort);if(timer)clearTimeout(timer);try{if(worker)await worker.terminate();}finally{active--;}}
}
/** A worker bounds SDK schema compilation as well as network/body processing. No retry. */
export function createHttpMcpExecution(options:McpExecutionOptions={}):McpExecutionCall {
 return async(raw,args,control)=>{
  const tool=McpFrozenTool.parse(raw);
  if(Buffer.byteLength(JSON.stringify(args))>L.maxArgsBytes||Buffer.byteLength(JSON.stringify(tool))>L.maxResultBytes)throw new Error('mcp_execution_unavailable');
  return McpInvokeOutput.parse(await runWorker({tool,args},{...options,timeoutMs:Math.min(options.timeoutMs??L.deadlineMs,(control?.deadlineAt??Date.now()+L.deadlineMs)-Date.now())},control?.signal));
 };
}
/** Review compiles the entire bounded batch with the same official validator, without network access. */
export async function validateMcpToolSchemas(raw:readonly z.infer<typeof McpRuntimeTool>[]):Promise<void>{
 if(raw.length>L.maxTools||Buffer.byteLength(JSON.stringify(raw))>L.maxResultBytes)throw new Error('mcp_review_schema_limit');
 const schemas=raw.map(t=>McpRuntimeTool.parse(t));
 await runWorker({schemas},{});
}

/** Private infrastructure envelope. It is never included in a tool schema, receipt or result. */
export async function executeSealedMcp(tool:z.infer<typeof McpFrozenTool>,args:Record<string,unknown>,sealed:{ciphertext:string;key:string},options:McpExecutionOptions,control:McpExecutionControl){
 if(Buffer.byteLength(JSON.stringify(args))>L.maxArgsBytes||Buffer.byteLength(JSON.stringify(tool))>L.maxResultBytes)throw new Error('mcp_execution_unavailable');
 return McpInvokeOutput.parse(await runWorker({tool,args,sealed},{...options,timeoutMs:Math.min(options.timeoutMs??L.deadlineMs,(control.deadlineAt??Date.now()+L.deadlineMs)-Date.now())},control.signal));
}
