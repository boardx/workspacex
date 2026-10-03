import type { Page,CDPSession } from '@playwright/test';

const types = new Set(['hello', 'update', 'restore-deletion', 'awareness', 'sync', 'ack', 'error', 'recovery', 'presence']);
/** Whitelist only transport metadata; never return payloads, credentials, URLs or error text. */
export function spatialFrameMetadata(payload: string | Buffer) {
  try {
    const value: unknown = JSON.parse(payload.toString());
    if (!value || typeof value !== 'object') return { type: 'invalid' };
    const frame = value as Record<string, unknown>;
    return {
      type: typeof frame.type === 'string' && types.has(frame.type) ? frame.type : 'unknown',
      ...(typeof frame.updateId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(frame.updateId) ? { updateId: frame.updateId } : {}),
      ...(typeof frame.gestureId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(frame.gestureId) ? { gestureId: frame.gestureId } : {}),
      ...(typeof frame.seq === 'number' && Number.isSafeInteger(frame.seq) && frame.seq >= 0 ? { seq: frame.seq } : {}),
      ...(frame.type === 'update' && typeof frame.epoch === 'number' && Number.isSafeInteger(frame.epoch) && frame.epoch > 0 ? { epoch: frame.epoch } : {}),
      ...(typeof frame.code === 'string' && /^[A-Z_]{1,64}$/.test(frame.code) ? { code: frame.code } : {}),
    };
  } catch { return { type: 'invalid' }; }
}

export function createSpatialWsMetadataRecorder() {
  const started = performance.now();
  const events: Array<Record<string, unknown>> = [];
  let dropped = 0, nextSocket = 0;
  const record = (entry: Record<string, unknown>) => {
    if (events.length >= 10_000) { dropped++; return; }
    events.push({ elapsedMs: performance.now() - started, ...entry });
  };
  return {
    observe(page: Page, client: 'original' | 'peer') {
      page.on('websocket', socket => {
        if (!/\/whiteboards\/[^/]+\/sync$/.test(new URL(socket.url()).pathname)) return;
        const socketId = ++nextSocket;
        record({ client, socketId, direction: 'open' });
        socket.on('framesent', frame => record({ client, socketId, direction: 'sent', ...spatialFrameMetadata(frame.payload) }));
        socket.on('framereceived', frame => record({ client, socketId, direction: 'received', ...spatialFrameMetadata(frame.payload) }));
        socket.on('close', () => record({ client, socketId, direction: 'close' }));
        socket.on('socketerror', () => record({ client, socketId, direction: 'socketerror' }));
      });
    },
    observeCdp(session:CDPSession,client:'original'|'peer'){
      const sockets=new Map<string,number>();let ordinal=0;
      const created=(event:{requestId:string;url:string})=>{try{if(ordinal<10000&&typeof event.url==='string'&&event.url.length<=8192&&/\/whiteboards\/[^/]+\/sync$/.test(new URL(event.url).pathname))sockets.set(event.requestId,++ordinal);}catch{ /* Malformed diagnostic URLs cannot affect transport. */ }};
      const failed=(event:{requestId:string;errorMessage:string})=>{const socketOrdinal=sockets.get(event.requestId);if(socketOrdinal){const message=Object.getOwnPropertyDescriptor(event,'errorMessage')?.value;record({client,socketOrdinal,direction:'cdp-socketerror',code:nativeSocketErrorCode(message),messageClass:nativeSocketMessageClass(message)});}};
      const closed=(event:{requestId:string})=>{const socketOrdinal=sockets.get(event.requestId);if(socketOrdinal)record({client,socketOrdinal,direction:'cdp-close'});};
      session.on('Network.webSocketCreated',created);session.on('Network.webSocketFrameError',failed);session.on('Network.webSocketClosed',closed);
      return()=>{const removals:Array<()=>void>=[()=>{session.off('Network.webSocketCreated',created);},()=>{session.off('Network.webSocketFrameError',failed);},()=>{session.off('Network.webSocketClosed',closed);}];let failure=false;for(const remove of removals)try{remove();}catch{failure=true;}if(failure)throw new Error('SOCKET_DIAGNOSTIC_STOP_FAILED');};
    },
    nativeClose(client:'original'|'peer',value:unknown){
      if(!value||typeof value!=='object')return;
      const descriptors=Object.getOwnPropertyDescriptors(value);
      if(Object.keys(descriptors).sort().join(',')!=='code,socketOrdinal,wasClean'||Object.values(descriptors).some(d=>!Object.hasOwn(d,'value')))return;
      const {socketOrdinal,code,wasClean}=Object.fromEntries(Object.entries(descriptors).map(([key,d])=>[key,d.value]));
      if(!Number.isSafeInteger(socketOrdinal)||socketOrdinal<1||socketOrdinal>10000||!Number.isInteger(code)||code<0||code>65535||typeof wasClean!=='boolean')return;
      record({client,socketOrdinal,direction:'nativeclose',code,wasClean});
    },
    snapshot: () => ({ events, dropped }),
  };
}

/** Fixed classifications only; the browser error string is never retained. */
export function nativeSocketErrorCode(message:unknown){
 const known=['ERR_NETWORK_IO_SUSPENDED','ERR_CONNECTION_RESET','ERR_CONNECTION_CLOSED','ERR_ABORTED','ERR_FAILED','ERR_NETWORK_CHANGED','ERR_INTERNET_DISCONNECTED'];
 if(typeof message!=='string'||message.length>8192)return 'UNKNOWN';
 const matches=known.filter(code=>new RegExp(`(?:^|[^A-Z_])(?:net::)?${code}(?:$|[^A-Z_])`).test(message));
 return matches.length===1?matches[0]:'UNKNOWN';
}
/** Exact pinned Chromium 151 reasons only; this is not a numeric net-error attribution. */
export function nativeSocketMessageClass(message:unknown){
 if(typeof message!=='string'||message.length>8192)return 'UNKNOWN';
 if(message==='')return 'EMPTY';
 // Chromium 151.0.7922.34 websocket_channel_impl.cc / net/websockets/websocket_channel.cc.
 switch(message){
  case 'Could not decode a text frame as UTF-8.':return 'UTF8_DECODE_FAILED';
  case 'Message size is too large.':return 'MESSAGE_TOO_LARGE';
  case 'Received unexpected continuation frame.':return 'UNEXPECTED_CONTINUATION';
  case 'Received start of new message but previous message is unfinished.':return 'UNFINISHED_MESSAGE';
  default:return 'UNKNOWN';
 }
}
/** Init-script observation only: native constructor, frames and close behavior remain untouched. */
export function installNativeSocketCloseObserver({binding,stateKey}:{binding:string;stateKey:string}){
 const original=globalThis.WebSocket,sockets=new Map<number,WebSocket>(),listeners=new Map<WebSocket,EventListener>();let ordinal=0;
 const observer=new Proxy(original,{construct(target,args,newTarget){
  const socket=Reflect.construct(target,args,newTarget) as WebSocket;
  try{if(ordinal<10000&&/\/whiteboards\/[^/]+\/sync$/.test(new URL(socket.url).pathname)){
   const socketOrdinal=++ordinal;sockets.set(socketOrdinal,socket);
   const listener:EventListener=raw=>{const event=raw as CloseEvent;
    if(!event.isTrusted)return;
    if(!Number.isInteger(event.code)||event.code<0||event.code>65535||typeof event.wasClean!=='boolean')return;
    const notify=(globalThis as unknown as Record<string,(value:unknown)=>Promise<void>>)[binding];
    if(typeof notify!=='function')return;
    try{void notify({socketOrdinal,code:event.code,wasClean:event.wasClean}).catch(()=>undefined);}catch{ /* Observation cannot change native close behavior. */ }
   };listeners.set(socket,listener);socket.addEventListener('close',listener);
  }}catch{ /* Observation cannot change native constructor return or throw behavior. */ }
  return socket;
 }});
 Object.defineProperty(globalThis,stateKey,{value:{sockets,listeners,original,observer},configurable:true});
 globalThis.WebSocket=observer;
}
