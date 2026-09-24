import type { Server } from 'node:http';
import { createHash, randomUUID, sign } from 'node:crypto';
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
import { readObjects } from '@repo/whiteboard-core';

type SoakConnection = { clientNonce: string; connectionId: string; role: 'owner' | 'editor' | 'viewer'; purpose: 'initial' | 'reconnect' | 'fresh' | 'server'; connectedAtMs: number; disconnectedAtMs: number | null };
type SoakRun = { runId: string; challenge: string; boardId: string; exactSha: string; environmentFingerprint: string; requiredDurationMs:number;expectedClients:number;expectedWriters:number;startedAtMs:number|null;connections: SoakConnection[]; operations: Map<string,{ id: string; writer: string; connectionId: string; seq: number; committedAtMs: number }>; finalized: boolean };
type Peer = { ws: WebSocket; principal: Principal; boardId: string; token: string; traceId: string; connectionId: string; clientNonce: string; soakRunId: string | null; ready: boolean; epoch: number; seq: number; role: 'owner' | 'editor' | 'viewer'; archived: boolean; mirror: Y.Doc; presence: ReturnType<typeof WhiteboardPresence.parse>; checking: boolean };
export interface WhiteboardGatewayDeps { principals: PrincipalResolverPort; boards: WhiteboardRepository; store: WhiteboardCollaborationStore; metrics?: WhiteboardObservability; logger?: LoggerPort; soakLedgerPrivateKey?: string; }
const encoded = (b: Uint8Array) => Buffer.from(b).toString('base64');
const decoded = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
const sessionFingerprint = (token:string) => createHash('sha256').update(token).digest('hex');
function canonicalJson(value:unknown):unknown{if(value===null||typeof value==='boolean'||typeof value==='string')return value;if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('non-finite whiteboard number');return Object.is(value,-0)?0:value;}if(Array.isArray(value))return value.map(canonicalJson);if(typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonicalJson(item)]));throw new Error('unsupported whiteboard value');}
function canonicalDocument(doc:Y.Doc):Record<string,unknown>[]{return readObjects(doc).map(item=>canonicalJson(item) as Record<string,unknown>).sort((a,b)=>String(a.id).localeCompare(String(b.id)));}
/** Bounded WS transport. Database serializes writers; only committed updates are broadcast. */
export function attachWhiteboardGateway(server: Server, deps: WhiteboardGatewayDeps): WebSocketServer {
  const metrics = deps.metrics ?? NOOP_WHITEBOARD_OBSERVABILITY;
  const wss = new WebSocketServer({ noServer: true, maxPayload: WHITEBOARD_SCALE_POLICY.websocket.frameBytes, perMessageDeflate: false,
    handleProtocols: protocols => protocols.has(WHITEBOARD_SYNC.protocol) ? WHITEBOARD_SYNC.protocol : false });
  const peers = new Set<Peer>();
  const soakRuns = new Map<string,SoakRun>();
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
        const peer:Peer={ws,principal,boardId,token,traceId,connectionId:randomUUID(),clientNonce:randomUUID(),soakRunId:null,ready:false,epoch:0,seq:0,role:board.role,archived:board.archived,mirror:new Y.Doc(),presence:{actorId:principal.userId,cursor:null,selected:[]},checking:false};
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
              peer.clientNonce=message.clientNonce ?? peer.clientNonce;
              if(decoded(message.stateVector).byteLength>1) metrics.reconnect();
              // Keep a server-only full mirror for cross-process catch-up, never trust client content.
              const full=await deps.store.load(principal,boardId);
              Y.applyUpdate(peer.mirror,full.update); peer.epoch=full.epoch; peer.seq=full.seq;
              const diff=await deps.store.load(principal,boardId,decoded(message.stateVector));
              Y.applyUpdate(peer.mirror,diff.update); peer.seq=diff.seq; peer.role=diff.role; peer.archived=diff.archived;
              const accessReceiptId=await deps.boards.issueQuarantineAccessReceipt(principal,boardId,sessionFingerprint(token),diff.epoch);
              let soakBinding: {runId:string;challenge:string}|undefined;
              if(message.soakRun) {
                if(!deps.soakLedgerPrivateKey) throw new WhiteboardCollaborationError('VALIDATION_FAILED');
                let run=soakRuns.get(message.soakRun.runId);
                if(!run) {
                  run={runId:message.soakRun.runId,challenge:randomUUID(),boardId,exactSha:message.soakRun.exactSha,environmentFingerprint:message.soakRun.environmentFingerprint,requiredDurationMs:message.soakRun.requiredDurationMs,expectedClients:message.soakRun.expectedClients,expectedWriters:message.soakRun.expectedWriters,startedAtMs:null,connections:[],operations:new Map(),finalized:false};
                  soakRuns.set(run.runId,run);
                }
                if(run.finalized || run.boardId!==boardId || run.exactSha!==message.soakRun.exactSha || run.environmentFingerprint!==message.soakRun.environmentFingerprint||run.requiredDurationMs!==message.soakRun.requiredDurationMs||run.expectedClients!==message.soakRun.expectedClients||run.expectedWriters!==message.soakRun.expectedWriters) throw new WhiteboardCollaborationError('VALIDATION_FAILED');
                const purpose=run.connections.some(item=>item.clientNonce===peer.clientNonce) ? 'reconnect' : message.soakRun.purpose;
                if(purpose==='initial'&&run.connections.filter(item=>item.purpose==='initial').length>=run.expectedClients)throw new WhiteboardCollaborationError('VALIDATION_FAILED');
                run.connections.push({clientNonce:peer.clientNonce,connectionId:peer.connectionId,role:diff.role,purpose,connectedAtMs:Date.now(),disconnectedAtMs:null});
                if(purpose==='initial'&&run.connections.filter(item=>item.purpose==='initial').length===run.expectedClients)run.startedAtMs=Date.now();
                peer.soakRunId=run.runId; soakBinding={runId:run.runId,challenge:run.challenge};
              }
              peer.ready=true; clearTimeout(deadline);
              send(ws,{type:'sync',...diff,update:encoded(diff.update),accessReceiptId,clientNonce:peer.clientNonce,connectionId:peer.connectionId,...(soakBinding?{soakBinding}:{})}); presence(peer); return;
            }
            if(!peer.ready) { fail(ws,'HELLO_REQUIRED',traceId); return; }
            if(message.type==='soak-finish') {
              const run=soakRuns.get(message.runId);
              const operations=[...run?.operations.values()??[]].sort((a,b)=>a.seq-b.seq||a.id.localeCompare(b.id)),finishedAtMs=operations.at(-1)?.committedAtMs??0;
              if(!deps.soakLedgerPrivateKey || !run || run.finalized || peer.role!=='owner' || peer.soakRunId!==run.runId || message.challenge!==run.challenge||run.startedAtMs===null||finishedAtMs-run.startedAtMs<run.requiredDurationMs||new Set(operations.map(item=>item.writer)).size<run.expectedWriters) throw new WhiteboardCollaborationError('VALIDATION_FAILED');
              run.finalized=true;
              const finalDocument=canonicalDocument(peer.mirror),finalHash=createHash('sha256').update(JSON.stringify(finalDocument)).digest('hex');
              const payload={schemaVersion:1 as const,runId:run.runId,challenge:run.challenge,boardId:run.boardId,exactSha:run.exactSha,environmentFingerprint:run.environmentFingerprint,requiredDurationMs:run.requiredDurationMs,expectedClients:run.expectedClients,expectedWriters:run.expectedWriters,startedAtMs:run.startedAtMs,finishedAtMs,connections:run.connections,operations,finalSeq:peer.seq,finalDocument,finalHash,finalizedAtMs:Date.now()};
              const signature=sign(null,Buffer.from(JSON.stringify(payload)),deps.soakLedgerPrivateKey).toString('base64');
              send(ws,{type:'soak-ledger',payload,signature}); return;
            }
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
            if(peer.soakRunId) {
              const run=soakRuns.get(peer.soakRunId);
              if(run && !run.finalized) for(const object of readObjects(peer.mirror)) {
                const id=object.text;
                if(typeof id==='string' && id.startsWith('soak-4144:') && !run.operations.has(id)) run.operations.set(id,{id,writer:peer.clientNonce,connectionId:peer.connectionId,seq:ack.seq,committedAtMs:Date.now()});
              }
            }
            send(ws,{type:'ack',updateId:ack.updateId,seq:ack.seq});
          }).catch(error=>{
            const code=error instanceof WhiteboardCollaborationError?error.code:'DEPENDENCY_UNAVAILABLE';
            fail(ws,code,traceId);
          }).finally(()=>{waiting--;});
        });
        ws.on('error',()=>ws.close());
        ws.on('close',()=>{clearTimeout(deadline);if(peers.delete(peer))metrics.connection(-1);const run=peer.soakRunId?soakRuns.get(peer.soakRunId):undefined;const connection=run?.connections.find(item=>item.connectionId===peer.connectionId);if(connection&&!connection.disconnectedAtMs)connection.disconnectedAtMs=Date.now();peer.mirror.destroy();presence(peer);});
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
