import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import * as Y from 'yjs';
import {createWhiteboardDocument,executeCommands,readObjects,SpatialRelationshipCommandPort,type WhiteboardObject} from '@repo/whiteboard-core';
import {CollaborativeEditor} from '@/components/whiteboard/collaborative-editor';

// Keep the actual editor capture/bubble handlers and actual Connector DOM handles.
// Only Fabric paint is isolated: this regression targets the overlay event bridge.
vi.mock('@/components/whiteboard/board-comments',()=>({listBoardMentionableMembers:async()=>[],listBoardCommentThreads:async()=>[]}));
vi.mock('@/components/whiteboard/fabric/board-fabric-surface',()=>({BoardFabricSurface:({onSelectionChange}:any)=><div data-testid="board-fabric-surface"><button onClick={()=>onSelectionChange(['edge'],'canvas')}>select edge for snap</button></div>}));
globalThis.ResizeObserver=class{observe(){}disconnect(){}} as unknown as typeof ResizeObserver;
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

class OverlayPointerEvent extends MouseEvent{
 readonly pointerId:number;
 constructor(type:string,init:MouseEventInit&{pointerId?:number}={}){super(type,init);this.pointerId=init.pointerId??1;}
}
function pointer(target:Element,type:string,x:number,y:number){
 fireEvent(target,new OverlayPointerEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y,pointerId:1}));
}

it.each(['quick','slow','release-only','cancel','late-target-lock'] as const)('actual React Connector snap event chain: %s',mode=>{
 vi.stubGlobal('PointerEvent',OverlayPointerEvent);
 const doc=createWhiteboardDocument();
 const node=(id:string,x:number):WhiteboardObject=>({id,schemaVersion:1,kind:'sticky',geometry:{x,y:0,width:100,height:80,rotation:0},text:'',style:{},parentId:null,orderKey:id});
 executeCommands(doc,[...['a','b','c'].map((id,index)=>({type:'create' as const,object:node(id,index*300)})),{type:'create',object:{...node('edge',100),kind:'connector',connector:{from:'a',to:'b',fromAnchor:'right',toAnchor:'left',type:'straight',label:'snap fixture'}}}],'fixture');
 const dispatch=vi.spyOn(SpatialRelationshipCommandPort.prototype,'dispatch');
 try{
  render(<CollaborativeEditor boardId="snap-board" clientId="snap-client" doc={doc} readOnly={false} title="Snap" status="Connected"/>);
  fireEvent.click(screen.getByText('select edge for snap'));
  const handle=screen.getByTestId('board-connector-handle-to');
  const capture=new Set<number>();
  handle.setPointerCapture=id=>{capture.add(id);};handle.hasPointerCapture=id=>capture.has(id);handle.releasePointerCapture=id=>{capture.delete(id);};
  const editor=screen.getByTestId('collaborative-editor');
  // Existing authority fixtures use this same host/world identity at default viewport.
  vi.spyOn(editor,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:1000,bottom:700,width:1000,height:700,toJSON(){return {};}});
  const before=Y.encodeStateAsUpdate(doc);
  act(()=>pointer(handle,'pointerdown',300,40));
  const move=()=>pointer(handle,'pointermove',600,40);
  const release=()=>pointer(handle,'pointerup',600,40);
  let rejectedBaseline=before;
  if(mode==='slow'){
   act(move);expect(screen.getByTestId('board-connector-snap-cue')).toHaveAttribute('data-target-id','c');act(release);
  }else if(mode==='release-only')act(release);
  else act(()=>{
   move();
   if(mode==='cancel')pointer(handle,'pointercancel',600,40);
   else{
    if(mode==='late-target-lock'){executeCommands(doc,[{type:'state',id:'c',locked:true}],'remote');rejectedBaseline=Y.encodeStateAsUpdate(doc);}
    release();
   }
  });
  if(mode==='cancel'||mode==='late-target-lock'){
   expect(dispatch).not.toHaveBeenCalled();expect(Y.encodeStateAsUpdate(doc)).toEqual(rejectedBaseline);
   expect(readObjects(doc).find(object=>object.id==='edge')!.connector!.to).toBe('b');
  }else{
   expect(dispatch).toHaveBeenCalledOnce();expect(dispatch.mock.calls[0]![0].command).toMatchObject({type:'update-connector',id:'edge',relationship:{from:'a',to:'c',fromAnchor:'right',toAnchor:'left'}});
   const canonical=readObjects(doc).find(object=>object.id==='edge')!;expect(canonical.connector!.to).toBe('c');expect(canonical.connector).not.toHaveProperty('toPoint');
   const reloaded=createWhiteboardDocument();try{Y.applyUpdate(reloaded,Y.encodeStateAsUpdate(doc));expect(readObjects(reloaded)).toEqual(readObjects(doc));}finally{reloaded.destroy();}
  }
  expect(screen.queryByTestId('board-connector-snap-cue')).not.toBeInTheDocument();
 }finally{cleanup();doc.destroy();}
});
