import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {it,expect} from 'vitest';
import {LangChainEmbeddingClient} from '../../src/infrastructure/retrieval/langchain-embedding-client';
import {RETRIEVAL_EMBEDDING_LIMITS as L} from '@repo/contracts/retrieval-embedding';
it('real internal HTTP carries actual input and only service credential; rejects response identity drift and redirects without retry',async()=>{
 let mode='success',calls=0;const seen:unknown[]=[];
 const server=createServer(async(req,res)=>{
  calls++;let body='';for await(const chunk of req)body+=chunk;seen.push({path:req.url,key:req.headers['x-deep-agent-internal-key'],body:JSON.parse(body)});
  if(mode==='redirect'){res.writeHead(307,{location:'/unexpected'});res.end();return;}
  if(mode==='oversize'){res.end('x'.repeat(L.maxResponseBytes+1));return;}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({model:mode==='identity'?'different':'explicit',modelVersion:'v1',vectors:[[0.5,0.25]]}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const client=new LangChainEmbeddingClient({baseUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,internalKey:'service-only',model:'explicit',modelVersion:'v1'});
  expect(await client.embed('actual 中文 text')).toEqual([0.5,0.25]);expect(seen[0]).toEqual({path:'/internal/retrieval/embeddings',key:'service-only',body:{texts:['actual 中文 text']}});
  for(mode of ['identity','redirect','oversize']){const before=calls;await expect(client.embed('source')).rejects.toThrow('embedding_unavailable');expect(calls).toBe(before+1);}
  expect(JSON.stringify(client)).not.toContain('service-only');
 }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
