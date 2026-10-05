import { expect, it } from 'vitest';
import { createFixedPublicJsonReader } from './fixed_public_json_reader';
const url='https://example.invalid/api/healthz',stamp='2026-10-04T17:00:00.000Z';
function response(body:string,urlValue=url,headers:Record<string,string>={'content-type':'application/json'}) {const r=new Response(body,{status:200,headers});Object.defineProperty(r,'url',{value:urlValue});return r;}
const policy={publicOrigin:'https://example.invalid/',timeoutMs:50,maximumBytes:128};
it('reads only fixed HTTPS endpoints with no redirect/cache/credentials and local timestamp',async()=>{
 let options:any;const fetcher:typeof fetch=async(_url,init)=>{options=init;return response('{"trustworthy":true}');};
 const read=createFixedPublicJsonReader(policy,{fetch:fetcher,now:()=>new Date(stamp)});
 expect(await read(url)).toEqual({url,status:200,observedAt:stamp,body:{trustworthy:true}});
 expect(options).toMatchObject({method:'GET',redirect:'error',cache:'no-store',credentials:'omit'});expect(options.signal.aborted).toBe(true);
 await expect(read('https://example.invalid/other')).rejects.toThrow('PUBLIC_JSON_FIXED_ENDPOINT_REQUIRED');
});
it('rejects redirects, wrong media, invalid UTF8/JSON, arrays and declared or streamed oversize',async()=>{
 for(const result of [response('{}','https://other.invalid/'),response('{}',url,{'content-type':'text/html'}),response('[]'),response('not-json'),response('{}',url,{'content-type':'application/json','content-length':'129'}),response('x'.repeat(129))]){
  await expect(createFixedPublicJsonReader(policy,{fetch:async()=>result,now:()=>new Date(stamp)})(url)).rejects.toThrow();
 }
 const invalid=new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}});Object.defineProperty(invalid,'url',{value:url});
 await expect(createFixedPublicJsonReader(policy,{fetch:async()=>invalid,now:()=>new Date(stamp)})(url)).rejects.toThrow();
});
it('bounds both fetch and stalled response body even when injected fetch ignores abort',async()=>{
 const read=createFixedPublicJsonReader({...policy,timeoutMs:5},{fetch:async()=>new Promise<Response>(()=>{}),now:()=>new Date(stamp)});
 await expect(read(url)).rejects.toThrow('PUBLIC_JSON_TIME_BUDGET');
 let cancelled=false;const r=new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}});Object.defineProperty(r,'url',{value:url});
 await expect(createFixedPublicJsonReader({...policy,timeoutMs:5},{fetch:async()=>r,now:()=>new Date(stamp)})(url)).rejects.toThrow('PUBLIC_JSON_TIME_BUDGET');expect(cancelled).toBe(true);
});
