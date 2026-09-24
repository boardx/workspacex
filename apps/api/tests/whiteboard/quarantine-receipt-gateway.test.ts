import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { afterEach, expect, it, vi } from 'vitest';
import { WHITEBOARD_SYNC } from '@repo/contracts/whiteboard-sync';
import type { WhiteboardRepository } from '../../src/application/whiteboard/ports';
import type { WhiteboardCollaborationStore } from '../../src/application/whiteboard/collaboration-ports';
import { toOrgId } from '../../src/domain/org-id';
import { attachWhiteboardGateway } from '../../src/interface/ws/whiteboard.gateway';

const closers:Array<()=>Promise<void>>=[];
afterEach(async()=>{while(closers.length)await closers.pop()!();});

it('never sends sync or accepts an update when access-receipt issuance fails',async()=>{
  const boardId='11111111-1111-4111-8111-111111111111';
  const principal={orgId:toOrgId('receipt-gateway-org'),userId:'receipt-user'};
  const doc=new Y.Doc(),append=vi.fn();
  const state={epoch:1,seq:0,update:Y.encodeStateAsUpdate(doc),role:'editor' as const,archived:false};
  const store={load:vi.fn().mockResolvedValue(state),append} as unknown as WhiteboardCollaborationStore;
  const boards={
    get:vi.fn().mockResolvedValue({id:boardId,role:'editor',archived:false}),
    issueQuarantineAccessReceipt:vi.fn().mockRejectedValue(new Error('receipt storage unavailable')),
  } as unknown as WhiteboardRepository;
  const server=createServer((_request,response)=>{response.statusCode=404;response.end();});
  const gateway=attachWhiteboardGateway(server,{store,boards,principals:{resolve:async()=>principal}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  closers.push(async()=>{gateway.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));doc.destroy();});
  const address=server.address() as AddressInfo;
  const socket=new WebSocket(`ws://127.0.0.1:${address.port}/whiteboards/${boardId}/sync`,[WHITEBOARD_SYNC.protocol,`${WHITEBOARD_SYNC.bearerSubprotocolPrefix}token`]);
  closers.push(async()=>{if(socket.readyState!==WebSocket.CLOSED)socket.terminate();});
  const messages:Array<{type:string;code?:string}>=[];socket.on('message',bytes=>messages.push(JSON.parse(bytes.toString()) as {type:string;code?:string}));
  await new Promise<void>((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  const closed=new Promise<number>(resolve=>socket.once('close',resolve));
  socket.send(JSON.stringify({type:'hello',stateVector:Buffer.from(Y.encodeStateVector(doc)).toString('base64')}));
  socket.send(JSON.stringify({type:'update',epoch:1,updateId:randomUUID(),update:'AA=='}));
  expect(await closed).toBe(4403);
  expect(messages).toContainEqual({type:'error',code:'DEPENDENCY_UNAVAILABLE'});
  expect(messages.some(message=>message.type==='sync')).toBe(false);
  expect(append).not.toHaveBeenCalled();
});

it('completes 50 concurrent hellos through a five-checkout budget with one load each',async()=>{
  const boardId='22222222-2222-4222-8222-222222222222';
  const principal={orgId:toOrgId('receipt-gateway-pool-org'),userId:'pool-user'};
  const doc=new Y.Doc(),state={epoch:1,seq:0,update:Y.encodeStateAsUpdate(doc),role:'editor' as const,archived:false};
  let active=0,peak=0;
  const checkout=async<T>(work:()=>T|Promise<T>):Promise<T>=>{
    while(active>=5)await new Promise(resolve=>setTimeout(resolve,1));
    active++;peak=Math.max(peak,active);
    try{await new Promise(resolve=>setTimeout(resolve,2));return await work();}finally{active--;}
  };
  const load=vi.fn(()=>checkout(()=>state));
  const issue=vi.fn(()=>checkout(()=>randomUUID()));
  const store={load,append:vi.fn()} as unknown as WhiteboardCollaborationStore;
  const boards={get:vi.fn().mockResolvedValue({id:boardId,role:'editor',archived:false}),issueQuarantineAccessReceipt:issue} as unknown as WhiteboardRepository;
  const server=createServer((_request,response)=>{response.statusCode=404;response.end();});
  const gateway=attachWhiteboardGateway(server,{store,boards,principals:{resolve:async()=>principal}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  closers.push(async()=>{gateway.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));doc.destroy();});
  const port=(server.address() as AddressInfo).port;
  const connect=async()=>{
    const socket=new WebSocket(`ws://127.0.0.1:${port}/whiteboards/${boardId}/sync`,[WHITEBOARD_SYNC.protocol,`${WHITEBOARD_SYNC.bearerSubprotocolPrefix}token`]);
    closers.push(async()=>{if(socket.readyState!==WebSocket.CLOSED)socket.terminate();});
    await new Promise<void>((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
    const synced=new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('hello timeout')),2000);socket.on('message',bytes=>{const message=JSON.parse(bytes.toString()) as {type:string};if(message.type==='sync'){clearTimeout(timeout);resolve();}});});
    socket.send(JSON.stringify({type:'hello',stateVector:Buffer.from(Y.encodeStateVector(new Y.Doc())).toString('base64')}));
    await synced;
  };
  await Promise.all(Array.from({length:50},connect));
  expect(load).toHaveBeenCalledTimes(50);expect(issue).toHaveBeenCalledTimes(50);expect(peak).toBeLessThanOrEqual(5);
});

it.each([new Uint8Array([0xff]),new Uint8Array(8192).fill(0xff),new Uint8Array(8193).fill(0xff)])(
  'maps malformed and over-ceiling state vectors to validation failure',async stateVector=>{
    const boardId='33333333-3333-4333-8333-333333333333';
    const principal={orgId:toOrgId('receipt-gateway-vector-org'),userId:'vector-user'};
    const doc=new Y.Doc(),state={epoch:1,seq:0,update:Y.encodeStateAsUpdate(doc),role:'editor' as const,archived:false};
    const store={load:vi.fn().mockResolvedValue(state),append:vi.fn()} as unknown as WhiteboardCollaborationStore;
    const boards={get:vi.fn().mockResolvedValue({id:boardId,role:'editor',archived:false}),issueQuarantineAccessReceipt:vi.fn().mockResolvedValue(randomUUID())} as unknown as WhiteboardRepository;
    const server=createServer((_request,response)=>{response.statusCode=404;response.end();});
    const gateway=attachWhiteboardGateway(server,{store,boards,principals:{resolve:async()=>principal}});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    closers.push(async()=>{gateway.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));doc.destroy();});
    const socket=new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/whiteboards/${boardId}/sync`,[WHITEBOARD_SYNC.protocol,`${WHITEBOARD_SYNC.bearerSubprotocolPrefix}token`]);
    closers.push(async()=>{if(socket.readyState!==WebSocket.CLOSED)socket.terminate();});
    await new Promise<void>((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
    const result=new Promise<{type:string;code:string}>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('validation response timeout')),2000);socket.on('message',bytes=>{const message=JSON.parse(bytes.toString()) as {type:string;code:string};if(message.type==='error'){clearTimeout(timeout);resolve(message);}});});
    socket.send(JSON.stringify({type:'hello',stateVector:Buffer.from(stateVector).toString('base64')}));
    await expect(result).resolves.toEqual({type:'error',code:'VALIDATION_FAILED'});
  },5000,
);
