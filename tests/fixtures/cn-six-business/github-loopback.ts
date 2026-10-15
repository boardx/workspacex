/** Explicit external-service boundary; never returns application journey verdicts. */
import http from 'node:http';
export async function startGithubProtocolFixture(){
 let reads=0;const originalFetch=globalThis.fetch;
 const prefix='/repos/fixture-only/six-journey/issues/1';
 const provider=http.createServer((req,res)=>{
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  res.setHeader('Content-Type','application/json');
  if(req.url===prefix){reads++;res.end(JSON.stringify({state:'open',state_reason:null}));return;}
  if(req.url===prefix+'/timeline?per_page=100'){reads++;res.end('[]');return;}
  res.writeHead(404);res.end('{}');
 });
 await new Promise<void>((resolve,reject)=>{provider.once('error',reject);provider.listen(0,'127.0.0.1',resolve);});
 const upstream='http://127.0.0.1:'+(provider.address()as import('node:net').AddressInfo).port;
 const request=(async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.origin==='https://api.github.com'){
   const method=init?.method??(input instanceof Request?input.method:'GET');
   if(method!=='GET'||!['', '?per_page=100'].includes(url.search)||![prefix,prefix+'/timeline'].includes(url.pathname))throw Error('GITHUB_FIXTURE_READ_SCOPE');
   // Real HTTP exchange with the local protocol service; no remote fallback.
   return originalFetch(upstream+url.pathname+url.search,{...init,redirect:'error'});
  }
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('EXTERNAL_FETCH_FORBIDDEN');
  return originalFetch(input,{...init,redirect:'error'});
 })as typeof fetch;
 return {fetch:request,reads:()=>reads,close:()=>new Promise<void>((resolve,reject)=>provider.close(e=>e?reject(e):resolve()))};
}
