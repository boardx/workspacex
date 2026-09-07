import {IMAGE_GENERATE_LIMITS as L} from '@repo/contracts/standard-image-tools';
import {assertMcpEndpointAllowed} from '../../domain/mcp/remote-endpoint-guard';
import {createGuardedFetch,type GuardedFetchOptions} from '../mcp/guarded-fetch';
import {sniffKind} from '../../domain/files/mime-sniff';
import type {GeneratedImageDownloader} from '../../application/agent-run/standard-image-tools';
export function createGeneratedImageDownloader(options:GuardedFetchOptions={connectTimeoutMs:L.downloadMs}):GeneratedImageDownloader{
 const fetcher=createGuardedFetch(options);
 return {async download(raw,callerSignal){
  const url=assertMcpEndpointAllowed(raw,{localOnlyOrg:false});
  const signal=AbortSignal.any([callerSignal,AbortSignal.timeout(L.downloadMs)]);
  const response=await fetcher(url,{signal,redirect:'error',headers:{Accept:'image/png,image/jpeg','Accept-Encoding':'identity'}});
  if(!response.ok||response.headers.get('content-encoding')&&!['identity'].includes(response.headers.get('content-encoding')!)){await response.body?.cancel();throw new Error('generated_image_download_failed');}
  const declared=response.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>L.maxBytes)){await response.body?.cancel();throw new Error('generated_image_size');}
  const reader=response.body?.getReader();if(!reader)throw new Error('generated_image_empty');let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>L.maxBytes)throw new Error('generated_image_size');chunks.push(value);}}finally{await reader.cancel();}
  const bytes=Buffer.concat(chunks),kind=sniffKind(bytes);if(kind!=='png'&&kind!=='jpeg')throw new Error('generated_image_format');
  return {bytes,mime:kind==='png'?'image/png':'image/jpeg'};
 }};
}
