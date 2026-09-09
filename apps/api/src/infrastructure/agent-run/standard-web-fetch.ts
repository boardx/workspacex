import {STANDARD_WEB_LIMITS as L} from '@repo/contracts/standard-web-tools';
import {assertMcpEndpointAllowed} from '../../domain/mcp/remote-endpoint-guard';
import {createGuardedFetch,type GuardedFetchOptions} from '../mcp/guarded-fetch';
import {StandardWebFailure,classifyStandardWebFailure} from '../../domain/agent-run/standard-web-failure';
/** Existing literal and connection-time DNS guards; no redirects or remote credentials. */
export function createStandardWebFetch(options:GuardedFetchOptions={connectTimeoutMs:L.deadlineMs}):typeof fetch {
 const guarded=createGuardedFetch(options);
 return (async(input,init)=>{
  // 字面量门（私网/凭据/非 https…）是**我们自己的**策略，不是网站拒绝——如实说成
  // `blocked_by_policy`，别混进 `upstream_refused`（issue #3204 ②）。
  let url:URL;
  try{url=assertMcpEndpointAllowed(String(input),{localOnlyOrg:false});}
  catch{throw new StandardWebFailure('blocked_by_policy');}
  let response:Response;
  try{response=await guarded(url,{...init,headers:{Accept:'text/html,text/plain,text/markdown,application/json','Accept-Encoding':'identity'},redirect:'error'});}
  catch(error){throw classifyStandardWebFailure(error);}
  // 上游状态码是判"被拒 / 不可达 / 超时"的唯一硬证据——此前它在这里被丢掉，
  // 于是 openai.com 的 `HTTP/2 403 + cf-mitigated: challenge` 在产品里跟"域名不存在"
  // 长得一模一样。带上它，只带数字，不带正文与响应头。
  if(!response.ok){await response.body?.cancel();throw new StandardWebFailure('upstream_refused',response.status);}
  if(response.headers.get('content-encoding')&&!['identity'].includes(response.headers.get('content-encoding')!)){
   await response.body?.cancel();throw new StandardWebFailure('unsupported_content');
  }
  const reader=response.body?.getReader();if(!reader)throw new StandardWebFailure('no_content');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>L.maxBodyBytes)throw new StandardWebFailure('too_large');chunks.push(value);}}
  finally{await reader.cancel();}
  return new Response(Buffer.concat(chunks),{status:200,headers:response.headers});
 }) as typeof fetch;
}
