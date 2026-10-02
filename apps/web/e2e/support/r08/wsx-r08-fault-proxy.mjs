import http from 'node:http';
import {readFile,lstat,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {FaultPolicy,fixedUpstream,scopedSession,sha256} from './wsx-r08-proxy-policy.mjs';

const equalSecret=(actual,expected)=>{
  const a=Buffer.from(String(actual??'')),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
};
export async function loadPrivateProxyConfig(path){
  const absolute=resolve(path),parent=await lstat(dirname(absolute)),uid=process.getuid();
  if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==uid||(parent.mode&0o077)!==0)throw new Error('PROXY_CONFIG_PARENT_MUST_BE_PRIVATE_OWNED');
  const metadata=await lstat(absolute);
  if(!metadata.isFile()||metadata.isSymbolicLink()||metadata.uid!==uid||(metadata.mode&0o777)!==0o600)throw new Error('PROXY_CONFIG_MUST_BE_PRIVATE_OWNED_0600');
  const handle=await open(absolute,constants.O_RDONLY|constants.O_NOFOLLOW);
  let config;
  try{
    const actual=await handle.stat();
    if(actual.dev!==metadata.dev||actual.ino!==metadata.ino||actual.uid!==uid||(actual.mode&0o777)!==0o600)throw new Error('PROXY_CONFIG_CHANGED_DURING_OPEN');
    config=JSON.parse(await handle.readFile('utf8'));
  }finally{await handle.close();}
  const canonical=JSON.parse(await readFile(config.nativeManifestPath,'utf8'));
  const upstream=fixedUpstream(canonical);
  if(config.upstream!==upstream||typeof config.controlSecret!=='string'||config.controlSecret.length<32||typeof config.bearerPrefix!=='string'||!config.bearerPrefix.length||!Number.isInteger(config.port)||config.port<1024||config.port>65535||config.port===canonical.ports.api)throw new Error('INVALID_PROXY_CONFIGURATION');
  return {...config,upstream,canonicalManifestSha256:sha256(await readFile(config.nativeManifestPath))};
}

/** Test-only transport. This function does not listen until start() is called. */
export function createFaultProxy(config){
  const upstream=new URL(config.upstream),policy=new FaultPolicy(config.scope);
  if(upstream.origin!==`http://127.0.0.1:${upstream.port}`||upstream.pathname!=='/'||upstream.search||upstream.hash||upstream.username||upstream.password||!/^[a-f0-9]{64}$/.test(config.canonicalManifestSha256??''))throw new Error('NON_CANONICAL_UPSTREAM');
  if(typeof config.controlSecret!=='string'||config.controlSecret.length<32||typeof config.bearerPrefix!=='string'||!config.bearerPrefix.length||!Number.isInteger(config.port)||config.port<1024||config.port>65535||config.port===Number(upstream.port))throw new Error('INVALID_PROXY_CONFIGURATION');
  const sockets=new Set(),ownedSockets=new Map(),requests=new Set();
  let stopping=false,started=false;
  const track=socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));return socket;};
  const server=http.createServer((request,response)=>{
    if(stopping){response.writeHead(503).end();return;}
    if(request.url?.startsWith('/__board_fault/')){
      if(!equalSecret(request.headers['x-board-fault-control'],config.controlSecret)){response.writeHead(403).end();return;}
      const command=request.url.slice('/__board_fault/'.length);
      try{
        if(command==='receipt'&&request.method==='GET'){response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(policy.receipt()));return;}
        if(request.method!=='POST'){response.writeHead(405).end();return;}
        if(command==='deny-once')policy.arm();
        else if(command==='restore')policy.restore();
        else if(command==='drop')for(const socket of ownedSockets.keys())socket.destroy();
        else{response.writeHead(404).end();return;}
        response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({runId:policy.runId,accepted:true}));
      }catch{response.writeHead(409).end();}
      return;
    }
    // Absolute request targets must not override the fixed upstream host.
    if(!request.url?.startsWith('/')||request.url.startsWith('//')){response.writeHead(400).end();return;}
    const remote=http.request({hostname:'127.0.0.1',port:upstream.port,path:request.url,method:request.method,headers:{...request.headers,host:upstream.host}},incoming=>{
      response.writeHead(incoming.statusCode??502,incoming.headers);incoming.pipe(response);
      incoming.on('error',()=>response.destroy());
    });
    requests.add(remote);remote.once('close',()=>requests.delete(remote));remote.setTimeout(10_000,()=>remote.destroy());
    remote.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end();});
    request.once('aborted',()=>remote.destroy());response.once('close',()=>{if(!response.writableFinished)remote.destroy();});request.pipe(remote);
  });
  server.on('connection',track);
  server.on('upgrade',(request,client,head)=>{
    if(stopping||!request.url?.startsWith('/')||request.url.startsWith('//')){client.destroy();return;}
    let sessionHash;
    try{sessionHash=scopedSession(request,policy.scope,config.bearerPrefix);}catch{client.destroy();return;}
    const connectionId=randomUUID();
    if(sessionHash&&!policy.authorizeAttempt(sessionHash,connectionId)){
      client.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;
    }
    const remote=http.request({hostname:'127.0.0.1',port:upstream.port,path:request.url,method:'GET',headers:{...request.headers,host:upstream.host}});
    requests.add(remote);remote.once('close',()=>requests.delete(remote));remote.setTimeout(10_000,()=>remote.destroy());
    const fail=()=>{if(!client.destroyed)client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');};
    remote.once('error',fail);remote.once('response',incoming=>{incoming.resume();fail();});
    client.once('close',()=>remote.destroy());
    remote.once('upgrade',(incoming,socket,upstreamHead)=>{
      track(socket);socket.setTimeout(0);
      if(stopping||client.destroyed){socket.destroy();return;}
      const headerLines=incoming.rawHeaders.reduce((values,value,index,array)=>index%2===0?[...values,`${value}: ${array[index+1]}`]:values,[]);
      client.write(`HTTP/1.1 101 Switching Protocols\r\n${headerLines.join('\r\n')}\r\n\r\n`);
      if(head.length)socket.write(head);if(upstreamHead.length)client.write(upstreamHead);
      if(sessionHash){
        policy.confirmUpgrade(sessionHash,connectionId,incoming.statusCode);
        ownedSockets.set(client,{socket,sessionHash,connectionId});
        client.once('close',()=>{ownedSockets.delete(client);socket.destroy();policy.record({connectionId,event:'closed',sessionSha256:sessionHash});});
      }
      socket.once('close',()=>client.destroy());socket.once('error',()=>client.destroy());client.once('error',()=>socket.destroy());
      client.pipe(socket);socket.pipe(client);
    });
    remote.end();
  });
  return {
    receipt:()=>policy.receipt(),
    async start(){
      if(started||stopping)throw new Error('PROXY_LIFECYCLE_INVALID');started=true;
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
      return {pid:process.pid,listener:`http://127.0.0.1:${config.port}`,upstream:config.upstream,canonicalManifestSha256:config.canonicalManifestSha256,runId:policy.runId};
    },
    async dispose(){
      if(stopping)return;stopping=true;const failures=[];
      for(const request of requests)try{request.destroy();}catch(error){failures.push(error);}
      for(const socket of sockets)try{socket.destroy();}catch(error){failures.push(error);}
      if(server.listening)await new Promise(resolve=>server.close(error=>{if(error)failures.push(error);resolve();}));
      if(failures.length)throw new AggregateError(failures,'PROXY_CLEANUP_FAILED');
    }
  };
}
