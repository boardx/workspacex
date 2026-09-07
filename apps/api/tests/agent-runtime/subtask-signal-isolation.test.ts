import {createServer} from 'node:http';
import {expect,it} from 'vitest';
import {DeepAgentModelProvider,readDeepAgentProviderConfig,deriveRemoteThreadId} from '../../src/infrastructure/agent-run/deep-agent-model-provider';

it('optional transport cancellation is scoped to one concurrent remote invocation and absent signal is unchanged',async()=>{
 let entered!:()=>void;const polling=new Promise<void>(r=>{entered=r;});let closed=false;const serialized:unknown[]=[];
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=String(chunk);
  const path=new URL(req.url!,'http://local').pathname,parts=path.split('/');
  const reply=(body:unknown)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(body));};
  if(req.method==='POST'&&path==='/threads'){reply({thread_id:JSON.parse(raw).thread_id});return;}
  if(req.method==='POST'&&path.endsWith('/runs')){serialized.push(JSON.parse(raw));reply({run_id:'run-'+parts[2]});return;}
  if(path.endsWith('/state')){reply({values:{messages:[{type:'ai',content:'other call finished'}]}});return;}
  if(parts.length===5){
   if(parts[2]===deriveRemoteThreadId('cancel-only-this')){res.on('close',()=>{closed=true;});entered();return;}
   reply({status:'success'});return;
  }
  reply({status:'idle'});
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const provider=new DeepAgentModelProvider({...readDeepAgentProviderConfig(),baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}`,timeoutMs:3000,pollIntervalMs:10});
 const abort=new AbortController(),other=new AbortController();
 const input={modelProvider:'deep-agent',modelId:'fake',system:'',user:'hi',executionMode:'text-only' as const};
 try{
  const first=provider.complete({...input,threadId:'cancel-only-this',signal:abort.signal});
  const rejected=expect(first).rejects.toThrow();await polling;
  const second=provider.complete({...input,threadId:'keep-this',signal:other.signal});
  abort.abort();await rejected;
  expect((await second).text).toBe('other call finished');
  expect((await provider.complete({...input,threadId:'no-signal'})).text).toBe('other call finished');
  const end=Date.now()+1000;while(!closed&&Date.now()<end)await new Promise(r=>setTimeout(r,10));
  expect(closed).toBe(true);expect(other.signal.aborted).toBe(false);
  expect(JSON.stringify(serialized)).not.toContain('"signal"');
 }finally{abort.abort();other.abort();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
