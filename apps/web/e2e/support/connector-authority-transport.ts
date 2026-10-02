import type {Page} from '@playwright/test';
import {spatialFrameMetadata} from './board-spatial-ws-metadata';
export function connectorAuthorityTransport(){
 const events:Array<Record<string,unknown>>=[];let dropped=0;
 const record=(event:Record<string,unknown>)=>{if(events.length>=10_000){dropped++;return;}events.push(event);};
 return {
  observe(page:Page,client:'original'|'peer',actor:()=>string){page.on('websocket',socket=>{
   const matched=new URL(socket.url()).pathname.match(/\/whiteboards\/([a-f0-9-]{36})\/sync$/i);if(!matched)return;
   const boardId=matched[1]!,actorId=actor(),metadata={boardId,actorId,client};record({...metadata,direction:'open'});
   socket.on('framesent',frame=>record({...metadata,direction:'sent',...spatialFrameMetadata(frame.payload)}));
   socket.on('framereceived',frame=>record({...metadata,direction:'received',...spatialFrameMetadata(frame.payload)}));
   socket.on('close',()=>record({...metadata,direction:'close'}));socket.on('socketerror',()=>record({...metadata,direction:'socketerror'}));
  });},
  snapshot:()=>({events,dropped}),
 };
}
