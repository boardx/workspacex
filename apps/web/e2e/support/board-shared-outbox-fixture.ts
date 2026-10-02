import { parsePanelMetadata } from '@repo/whiteboard-core';

export function sharedOutboxPanelCommands(ids: readonly string[]) {
  const spatial=parsePanelMetadata({version:1,mode:'freeform',autoExpand:false,clipContent:false,padding:0,gap:0,columns:1,flowDirection:'vertical',shape:'rectangle',template:'blank'});
  return ids.map((id,index)=>({type:'create' as const,object:{id,schemaVersion:1 as const,kind:'frame' as const,geometry:{x:(index%4)*1600,y:Math.floor(index/4)*1600,width:1200,height:1000,rotation:0},text:`Frame ${index+1}`,style:{},parentId:null,orderKey:String(index),extensionData:{spatial}}}));
}
