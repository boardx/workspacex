import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {test} from 'node:test';
import {createFaultProxy} from './wsx-r08-fault-proxy.mjs';
import {sha256} from './wsx-r08-proxy-policy.mjs';

const boardId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const scope={boardId,sessionHashes:[sha256('one'),sha256('two')]};
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve(server.address().port);});});
const close=server=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
async function exchange(port,path,body,headers={}){
 return new Promise((resolve,reject)=>{
  const request=http.request({host:'127.0.0.1',port,path,method:'POST',headers},response=>{
   const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.once('end',()=>resolve({status:response.statusCode,body:Buffer.concat(chunks)}));response.once('error',reject);
  });request.setTimeout(2000,()=>request.destroy(new Error('HTTP_TEST_TIMEOUT')));request.once('error',reject);request.end(body);
 });
}
async function upgrade(port,path,token,clients){
 const socket=net.connect(port,'127.0.0.1');clients.add(socket);socket.on('error',()=>{});
 await once(socket,'connect');
 const result=new Promise((resolve,reject)=>{
  let bytes=Buffer.alloc(0);const timer=setTimeout(()=>{socket.destroy();reject(new Error('UPGRADE_TEST_TIMEOUT'));},2000);
  const read=chunk=>{bytes=Buffer.concat([bytes,chunk]);const end=bytes.indexOf('\r\n\r\n');if(end<0)return;clearTimeout(timer);socket.removeListener('data',read);resolve(Number(bytes.toString('ascii',0,end).split(' ')[1]));};
  socket.on('data',read);socket.once('error',error=>{clearTimeout(timer);reject(error);});
 });
 socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Protocol: whiteboard,bearer.${token}\r\n\r\n`);
 return {socket,status:await result};
}

test('real loopback bytes, one 503, scoped socket drop and listener cleanup', {timeout:10000},async()=>{
 const upstreamSockets=new Set(),clients=new Set(),upgrades=[];
 const upstream=http.createServer((request,response)=>{const chunks=[];request.on('data',chunk=>chunks.push(chunk));request.on('end',()=>response.writeHead(201,{'content-type':'application/octet-stream'}).end(Buffer.concat(chunks)));});
 upstream.on('connection',socket=>{upstreamSockets.add(socket);socket.once('close',()=>upstreamSockets.delete(socket));});
 upstream.on('upgrade',(request,socket,head)=>{upgrades.push(request.url);socket.on('error',()=>{});socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');if(head.length)socket.write(head);socket.on('data',bytes=>socket.write(bytes));});
 let proxy,port,failure;const cleanupErrors=[];
 try{
  const upstreamPort=await listen(upstream),reservation=net.createServer();port=await listen(reservation);await close(reservation);
  proxy=createFaultProxy({upstream:`http://127.0.0.1:${upstreamPort}`,scope,controlSecret:'c'.repeat(32),bearerPrefix:'bearer.',port,canonicalManifestSha256:'a'.repeat(64)});await proxy.start();
  const raw=Buffer.from([0,255,13,10,0,128,42]);const forwarded=await exchange(port,'/v1/opaque',raw);assert.equal(forwarded.status,201);assert.deepEqual(forwarded.body,raw);
  const owned=await upgrade(port,`/v1/whiteboards/${boardId}/sync`,'one',clients);
  const foreign=await upgrade(port,'/v1/whiteboards/bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb/sync','one',clients);assert.equal(owned.status,101);assert.equal(foreign.status,101);
  const control=command=>exchange(port,`/__board_fault/${command}`,Buffer.alloc(0),{'x-board-fault-control':'c'.repeat(32)});
  assert.equal((await exchange(port,'/__board_fault/drop',Buffer.alloc(0))).status,403);assert.equal(owned.socket.destroyed,false);
  assert.equal((await control('deny-once')).status,200);const denied=await upgrade(port,`/v1/whiteboards/${boardId}/sync`,'two',clients);assert.equal(denied.status,503);assert.equal(upgrades.length,2);
  const recovered=await upgrade(port,`/v1/whiteboards/${boardId}/sync`,'two',clients);assert.equal(recovered.status,101);assert.equal(upgrades.length,3);assert.equal(proxy.receipt().deniedUpgradeCount,1);
  const before=proxy.receipt().requests.length;assert.equal((await control('restore')).status,200);assert.equal(proxy.receipt().requests.length,before);
  const ownedClosed=once(owned.socket,'close'),recoveredClosed=once(recovered.socket,'close');await control('drop');await Promise.all([ownedClosed,recoveredClosed]);assert.equal(foreign.socket.destroyed,false);
  const echoed=once(foreign.socket,'data');foreign.socket.write(raw);assert.deepEqual((await echoed)[0],raw);
  assert.equal(proxy.receipt().complete,true);
 }catch(error){failure=error;}
 finally{
  if(proxy)try{await proxy.dispose();}catch(error){cleanupErrors.push(error);}
  for(const socket of clients)socket.destroy();for(const socket of upstreamSockets)socket.destroy();
  if(upstream.listening)try{await close(upstream);}catch(error){cleanupErrors.push(error);}
 }
 if(failure||cleanupErrors.length)throw new AggregateError([...(failure?[failure]:[]),...cleanupErrors],'TRANSPORT_TEST_OR_CLEANUP_FAILED');
 assert.equal(upstream.listening,false);assert.ok([...clients].every(socket=>socket.destroyed));
 const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',resolve);});await close(probe);
});
