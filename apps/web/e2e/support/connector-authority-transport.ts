import type {Page} from '@playwright/test';
import {spatialFrameMetadata} from './board-spatial-ws-metadata';
export function connectorAuthorityTransport(){
 const events:Array<Record<string,unknown>>=[];let dropped=0;
 const record=(event:Record<string,unknown>)=>{if(events.length>=10_000){dropped++;return;}events.push(event);};
 return {
  observe(page:Page,client:'original'|'peer',actor:()=>string){page.on('websocket',socket=>{
   const matched=new URL(socket.url()).pathname.match(/\/whiteboards\/([a-f0-9-]{36})\/sync$/i);if(!matched)return;
   const boardId=matched[1]!,actorId=actor(),metadata={boardId,actorId,client};record({...metadata,direction:'open'});
   const frameMetadata=(payload:string|Buffer)=>{
    const base=spatialFrameMetadata(payload);let fields:Record<string,unknown>;try{fields=JSON.parse(payload.toString());}catch{return base;}if(!fields||typeof fields!=='object'||Array.isArray(fields))return base;
    return {...base,...(typeof fields.gestureId==='string'&&fields.gestureId.length>0&&fields.gestureId.length<=256?{gestureId:fields.gestureId}:{}),...(typeof fields.epoch==='number'&&Number.isSafeInteger(fields.epoch)&&fields.epoch>0?{epoch:fields.epoch}:{})};
   };
   socket.on('framesent',frame=>record({...metadata,direction:'sent',...frameMetadata(frame.payload)}));
   socket.on('framereceived',frame=>record({...metadata,direction:'received',...frameMetadata(frame.payload)}));
   socket.on('close',()=>record({...metadata,direction:'close'}));socket.on('socketerror',()=>record({...metadata,direction:'socketerror'}));
  });},
  snapshot:()=>({events,dropped}),
 };
}
