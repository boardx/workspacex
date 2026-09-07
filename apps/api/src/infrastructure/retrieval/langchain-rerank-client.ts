import {RETRIEVAL_RERANK_LIMITS as L,RetrievalRerankRequest,RetrievalRerankResponse} from '@repo/contracts/retrieval-rerank';
import type {RerankPort} from '../../application/retrieval/ports';
/** Infrastructure identity only; neither endpoint nor model is a tool argument. */
export class LangChainRerankClient implements RerankPort {
 #url:string;#key:string;
 constructor(config:{baseUrl:string;internalKey:string;model:string;modelVersion:string}){
  let url:URL;try{url=new URL(config.baseUrl);}catch{throw new Error('rerank_configuration_invalid');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!config.internalKey||!config.model||!config.modelVersion)throw new Error('rerank_configuration_invalid');
  this.#url=config.baseUrl.replace(/\/$/,'')+'/internal/retrieval/rerank';this.#key=config.internalKey;
  this.model=config.model;this.modelVersion=config.modelVersion;
 }
 readonly model:string;readonly modelVersion:string;
 async rerank(query:string,candidates:readonly{id:string;content:string}[]):Promise<readonly string[]>{
  if(candidates.some(c=>Buffer.byteLength(c.content)>L.maxTextBytes)||new Set(candidates.map(c=>c.id)).size!==candidates.length)throw new Error('rerank_input_invalid');
  const body=JSON.stringify(RetrievalRerankRequest.parse({query,candidates}));
  if(Buffer.byteLength(body)>L.maxRequestBytes)throw new Error('rerank_input_too_large');
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),L.deadlineMs);timer.unref();
  try{
   const response=await fetch(this.#url,{method:'POST',redirect:'error',signal:abort.signal,headers:{'content-type':'application/json','x-deep-agent-internal-key':this.#key},body});
   if(!response.ok||!response.body)throw new Error('rerank_unavailable');
   const chunks:Uint8Array[]=[];let bytes=0;
   for await(const chunk of response.body){bytes+=chunk.length;if(bytes>L.maxResponseBytes){abort.abort();throw new Error('rerank_unavailable');}chunks.push(chunk);}
   const output=RetrievalRerankResponse.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
   if(output.model!==this.model||output.modelVersion!==this.modelVersion||output.ids.length!==candidates.length||new Set(output.ids).size!==candidates.length||output.ids.some(id=>!candidates.some(c=>c.id===id)))throw new Error('rerank_unavailable');
   return output.ids;
  }catch{throw new Error('rerank_unavailable');}finally{clearTimeout(timer);}
 }
}
export function langChainRerankClientFromEnv():LangChainRerankClient|null{
 const model=process.env.KERNEL_RERANK_MODEL_ID??'',modelVersion=process.env.KERNEL_RERANK_MODEL_VERSION??'';
 if(!model&&!modelVersion)return null;
 return new LangChainRerankClient({baseUrl:process.env.KERNEL_DEEP_AGENT_BASE_URL??'',internalKey:process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??'',model,modelVersion});
}
