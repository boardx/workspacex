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
