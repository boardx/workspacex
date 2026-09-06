import {STANDARD_WEB_LIMITS as L} from '@repo/contracts/standard-web-tools';
import {assertMcpEndpointAllowed} from '../../domain/mcp/remote-endpoint-guard';
import {createGuardedFetch,type GuardedFetchOptions} from '../mcp/guarded-fetch';
/** Existing literal and connection-time DNS guards; no redirects or remote credentials. */
export function createStandardWebFetch(options:GuardedFetchOptions={connectTimeoutMs:L.deadlineMs}):typeof fetch {
 const guarded=createGuardedFetch(options);
 return (async(input,init)=>{
  const url=assertMcpEndpointAllowed(String(input),{localOnlyOrg:false});
  const response=await guarded(url,{...init,headers:{Accept:'text/html,text/plain,text/markdown,application/json','Accept-Encoding':'identity'},redirect:'error'});
  if(!response.ok||response.headers.get('content-encoding')&&!['identity'].includes(response.headers.get('content-encoding')!)){
   await response.body?.cancel();throw new Error('standard_web_response_refused');
  }
  const reader=response.body?.getReader();if(!reader)throw new Error('standard_web_empty');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>L.maxBodyBytes)throw new Error('standard_web_body_limit');chunks.push(value);}}
  finally{await reader.cancel();}
  return new Response(Buffer.concat(chunks),{status:200,headers:response.headers});
 }) as typeof fetch;
}
