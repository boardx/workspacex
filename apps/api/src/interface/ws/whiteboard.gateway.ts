import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import * as Y from 'yjs';
import { WHITEBOARD_SYNC, WhiteboardClientMessage, type WhiteboardServerMessage, WhiteboardPresence } from '@repo/contracts/whiteboard-sync';
import type { PrincipalResolverPort } from '../../application/ports/principal-resolver.port';
import type { WhiteboardRepository } from '../../application/whiteboard/ports';
import { WhiteboardCollaborationError, type WhiteboardCollaborationStore, type WhiteboardUpdateAck } from '../../application/whiteboard/collaboration-ports';
import type { Principal } from '../../domain/principal';
import type { LoggerPort } from '../../application/ports/logger.port';
import { NOOP_WHITEBOARD_OBSERVABILITY, whiteboardRejectReason, type WhiteboardObservability } from '../../application/whiteboard/observability';
import { WHITEBOARD_SCALE_POLICY } from '../../domain/whiteboard-scale-policy';

type Peer = { ws: WebSocket; principal: Principal; boardId: string; token: string; traceId: string; ready: boolean; epoch: number; seq: number; role: string; archived: boolean; mirror: Y.Doc; presence: ReturnType<typeof WhiteboardPresence.parse>; checking: boolean };
export interface WhiteboardGatewayDeps { principals: PrincipalResolverPort; boards: WhiteboardRepository; store: WhiteboardCollaborationStore; metrics?: WhiteboardObservability; logger?: LoggerPort; }
const encoded = (b: Uint8Array) => Buffer.from(b).toString('base64');
const decoded = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
/** Bounded WS transport. Database serializes writers; only committed updates are broadcast. */
export function attachWhiteboardGateway(server: Server, deps: WhiteboardGatewayDeps): WebSocketServer {
  const metrics = deps.metrics ?? NOOP_WHITEBOARD_OBSERVABILITY;
  const wss = new WebSocketServer({ noServer: true, maxPayload: WHITEBOARD_SCALE_POLICY.websocket.frameBytes, perMessageDeflate: false,
    handleProtocols: protocols => protocols.has(WHITEBOARD_SYNC.protocol) ? WHITEBOARD_SYNC.protocol : false });
  const peers = new Set<Peer>();
  function send(ws: WebSocket, message: WhiteboardServerMessage) {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > WHITEBOARD_SCALE_POLICY.websocket.outgoingBufferedBytes) { metrics.reject('limit'); ws.close(1013, 'slow client'); return; }
    ws.send(JSON.stringify(message));
  }
  function fail(ws: WebSocket, code: string, traceId = 'no-trace') {
    const reason=whiteboardRejectReason(code); metrics.reject(reason);
    metrics.trace(deps.logger,traceId,'reject',{outcome:'rejected',reason});
    send(ws,{type:'error',code}); ws.close(4403,code.slice(0,100));
  }
  function group(peer: Peer) { return [...peers].filter(p => p.ready && p.boardId===peer.boardId && p.principal.orgId===peer.principal.orgId); }
  function presence(peer: Peer) { const room=group(peer); const states=room.map(p=>p.presence); for (const p of room) send(p.ws,{type:'presence',peers:states}); }
  const upgrade = (request: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
    const path=new URL(request.url ?? '/', 'http://localhost').pathname;
    const match=/^\/whiteboards\/([0-9a-f-]{36})\/sync$/i.exec(path); if (!match) return;
    const traceId=randomUUID();
    const refuse=(status:number,reason: Parameters<WhiteboardObservability['reject']>[0]) => {
      metrics.reject(reason); metrics.trace(deps.logger,traceId,'upgrade',{outcome:'rejected',reason});
      socket.write(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`); socket.destroy();
    };
    const offered=String(request.headers['sec-websocket-protocol'] ?? '').split(',').map(s=>s.trim());
    const credential=offered.find(s=>s.startsWith(WHITEBOARD_SYNC.bearerSubprotocolPrefix));
    if (!credential || !offered.includes(WHITEBOARD_SYNC.protocol)) { refuse(401,'protocol'); return; }
    const token=credential.slice(WHITEBOARD_SYNC.bearerSubprotocolPrefix.length), boardId=match[1]!;
    void (async()=>{
      const principal=await deps.principals.resolve({authorization:`Bearer ${token}`}); if (!principal) { refuse(401,'access'); return; }
      const board=await deps.boards.get(principal,boardId); if (!board) { refuse(404,'access'); return; }
      if ([...peers].filter(p=>p.boardId===boardId && p.principal.orgId===principal.orgId).length>=WHITEBOARD_SCALE_POLICY.websocket.connectionsPerBoard) { refuse(429,'limit'); return; }
      wss.handleUpgrade(request,socket,head,ws=>{
        const peer:Peer={ws,principal,boardId,token,traceId,ready:false,epoch:0,seq:0,role:board.role,archived:board.archived,mirror:new Y.Doc(),presence:{actorId:principal.userId,cursor:null,selected:[]},checking:false};
        peers.add(peer); metrics.connection(1);
        const deadline=setTimeout(()=>{metrics.reject('protocol');ws.close(4408,'handshake timeout');},WHITEBOARD_SCALE_POLICY.websocket.handshakeMs);
        let queue=Promise.resolve(), waiting=0, awarenessAt=0;
        ws.on('message',(bytes,isBinary)=>{
          if (isBinary || waiting>=WHITEBOARD_SCALE_POLICY.websocket.pendingMessagesPerConnection) { fail(ws,'PROTOCOL_LIMIT',traceId); return; }
          let message: WhiteboardClientMessage;
          try { message=WhiteboardClientMessage.parse(JSON.parse(bytes.toString())); }
          catch { fail(ws,'PROTOCOL_ERROR',traceId); return; }
          waiting++;
          queue=queue.then(async()=>{
            if (ws.readyState!==ws.OPEN) return;
            if (message.type==='hello') {
              if(peer.ready) throw new WhiteboardCollaborationError('VALIDATION_FAILED');
              if(decoded(message.stateVector).byteLength>1) metrics.reconnect();
              // Keep a server-only full mirror for cross-process catch-up, never trust client content.
              const full=await deps.store.load(principal,boardId);
              Y.applyUpdate(peer.mirror,full.update); peer.epoch=full.epoch; peer.seq=full.seq;
              const diff=await deps.store.load(principal,boardId,decoded(message.stateVector));
              Y.applyUpdate(peer.mirror,diff.update); peer.seq=diff.seq; peer.ready=true; peer.role=diff.role; peer.archived=diff.archived; clearTimeout(deadline);
              send(ws,{type:'sync',...diff,update:encoded(diff.update)}); presence(peer); return;
            }
            if(!peer.ready) { fail(ws,'HELLO_REQUIRED',traceId); return; }
            if(message.type==='awareness') {
              if(Date.now()-awarenessAt<WHITEBOARD_SCALE_POLICY.websocket.awarenessIntervalMs) return; awarenessAt=Date.now();
              peer.presence={actorId:principal.userId,cursor:message.cursor,selected:message.selected}; presence(peer); return;
            }
            const started=performance.now();
            let ack: WhiteboardUpdateAck;
            try {
              ack=await deps.store.append(principal,boardId,{...message,update:decoded(message.update)});
              const elapsedMs=performance.now()-started;
              metrics.update('accepted',elapsedMs); metrics.trace(deps.logger,traceId,'update',{outcome:'accepted',elapsedMs});
            } catch (error) {
              metrics.update(error instanceof WhiteboardCollaborationError?'rejected':'error',performance.now()-started);
              throw error;
            }
            for(const target of group(peer)) {
              if(target.epoch!==ack.epoch) { fail(target.ws,'STALE_EPOCH',target.traceId); continue; }
              Y.applyUpdate(target.mirror,ack.update); if(ack.seq===target.seq+1) target.seq=ack.seq;
              send(target.ws,{type:'update',epoch:ack.epoch,seq:ack.seq,update:encoded(ack.update)});
            }
            send(ws,{type:'ack',updateId:ack.updateId,seq:ack.seq});
          }).catch(error=>{
            const code=error instanceof WhiteboardCollaborationError?error.code:'DEPENDENCY_UNAVAILABLE';
            fail(ws,code,traceId);
          }).finally(()=>{waiting--;});
        });
        ws.on('error',()=>ws.close());
        ws.on('close',()=>{clearTimeout(deadline);if(peers.delete(peer))metrics.connection(-1);peer.mirror.destroy();presence(peer);});
      });
    })().catch(()=>refuse(503,'dependency'));
  };
  server.on('upgrade',upgrade);
  // Fresh auth <=3s; also catches API writes and other replicas without trusting local caches.
  const monitor=setInterval(()=>{
    for(const peer of peers) {
      if(!peer.ready || peer.checking || peer.ws.readyState!==peer.ws.OPEN) continue;
      peer.checking=true;
      void (async()=>{
        const current=await deps.principals.resolve({authorization:`Bearer ${peer.token}`});
        if(!current || current.userId!==peer.principal.userId || current.orgId!==peer.principal.orgId) { fail(peer.ws,'FORBIDDEN',peer.traceId);return; }
        const head=await deps.store.head(current,peer.boardId);
        const state=head;
        if(state.epoch!==peer.epoch) { fail(peer.ws,'STALE_EPOCH',peer.traceId);return; }
        if(state.role!==peer.role || state.archived!==peer.archived) { fail(peer.ws,'PERMISSION_CHANGED',peer.traceId);return; }
        if(peer.ws.readyState!==peer.ws.OPEN) return;
        if(state.seq>peer.seq) { const diff=await deps.store.load(current,peer.boardId,Y.encodeStateVector(peer.mirror)); if(peer.ws.readyState!==peer.ws.OPEN) return; Y.applyUpdate(peer.mirror,diff.update);peer.seq=Math.max(peer.seq,diff.seq);send(peer.ws,{type:'update',epoch:diff.epoch,seq:diff.seq,update:encoded(diff.update)}); }
      })().catch(()=>fail(peer.ws,'ACCESS_UNAVAILABLE',peer.traceId)).finally(()=>{peer.checking=false;});
    }
  },1000);
  monitor.unref();
  server.on('close',()=>{clearInterval(monitor);server.off('upgrade',upgrade);for(const p of peers) p.ws.terminate();wss.close();});
  return wss;
}
