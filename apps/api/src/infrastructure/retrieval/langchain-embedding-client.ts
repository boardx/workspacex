import {RETRIEVAL_EMBEDDING_LIMITS as L,RetrievalEmbeddingRequest,RetrievalEmbeddingResponse} from '@repo/contracts/retrieval-embedding';
import type {EmbeddingPort} from '../../application/retrieval/ports';
/** Trusted service configuration only. Provider credentials remain in the Python service. */
export class LangChainEmbeddingClient implements EmbeddingPort {
 readonly model:string;
 readonly modelVersion:string;
 #url:string;#key:string;
 constructor(config:{baseUrl:string;internalKey:string;model:string;modelVersion:string}){
  let url:URL;try{url=new URL(config.baseUrl);}catch{throw new Error('embedding_configuration_invalid');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!config.internalKey||!config.model||!config.modelVersion)throw new Error('embedding_configuration_invalid');
  this.#url=config.baseUrl.replace(/\/$/,'')+'/internal/retrieval/embeddings';this.#key=config.internalKey;this.model=config.model;this.modelVersion=config.modelVersion;
 }
 async embed(text:string):Promise<readonly number[]>{
  if(Buffer.byteLength(text)>L.maxTextBytes)throw new Error('embedding_input_too_large');
  const body=JSON.stringify(RetrievalEmbeddingRequest.parse({texts:[text]}));
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),L.deadlineMs);timer.unref();
  try{
   const response=await fetch(this.#url,{method:'POST',redirect:'error',signal:abort.signal,headers:{'content-type':'application/json','x-deep-agent-internal-key':this.#key},body});
   if(!response.ok||!response.body)throw new Error('embedding_unavailable');
   const chunks:Uint8Array[]=[];let bytes=0;
   for await(const chunk of response.body){bytes+=chunk.length;if(bytes>L.maxResponseBytes){abort.abort();throw new Error('embedding_unavailable');}chunks.push(chunk);}
   const output=RetrievalEmbeddingResponse.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
   if(output.model!==this.model||output.modelVersion!==this.modelVersion||output.vectors.length!==1)throw new Error('embedding_unavailable');
   return output.vectors[0]!;
  }catch{throw new Error('embedding_unavailable');}finally{clearTimeout(timer);}
 }
}

export function langChainEmbeddingClientFromEnv():LangChainEmbeddingClient|null{
 const model=process.env.KERNEL_EMBEDDING_MODEL_ID??'',modelVersion=process.env.KERNEL_EMBEDDING_MODEL_VERSION??'';
 if(!model&&!modelVersion)return null;
 return new LangChainEmbeddingClient({baseUrl:process.env.KERNEL_DEEP_AGENT_BASE_URL??'',internalKey:process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??'',model,modelVersion});
}
