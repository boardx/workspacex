import type {Page} from '@playwright/test';
import {WHITEBOARD_SYNC} from '@repo/contracts/whiteboard-sync';
import {apiOrigin} from '../board-acceptance-support';
/** Native browser socket, recording only protocol types/codes, never bearer headers or contents. */
export async function securitySocket(page:Page,token:string,boardId:string,update?:string){
 return page.evaluate(({url,protocols,update})=>new Promise<{opened:boolean;sync:boolean;ack:boolean;error:string|null;closed:boolean;code:number|null}>((resolve,reject)=>{
  const result={opened:false,sync:false,ack:false,error:null as string|null,closed:false,code:null as number|null};
  const socket=new WebSocket(url,protocols);const timer=setTimeout(()=>{socket.close();reject(new Error('SECURITY_WS_EXPECTED_DENIAL_TIMEOUT'));},15000);
  socket.onopen=()=>{result.opened=true;socket.send(JSON.stringify({type:'hello',stateVector:'AA=='}));};
  socket.onmessage=event=>{const frame=JSON.parse(String(event.data));if(frame.type==='sync'){result.sync=true;if(update)socket.send(JSON.stringify({type:'update',epoch:frame.epoch,updateId:crypto.randomUUID(),gestureId:crypto.randomUUID(),update}));else{clearTimeout(timer);socket.close();resolve(result);}}if(frame.type==='ack')result.ack=true;if(frame.type==='error'){result.error=frame.code;clearTimeout(timer);socket.close();resolve(result);}};
  socket.onerror=()=>{};socket.onclose=event=>{result.closed=true;result.code=event.code;clearTimeout(timer);resolve(result);};
 }),{url:apiOrigin().replace(/^http/,'ws')+WHITEBOARD_SYNC.path.replace(':boardId',boardId),protocols:[WHITEBOARD_SYNC.protocol,WHITEBOARD_SYNC.bearerSubprotocolPrefix+token],update});
}
