import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {createWhiteboardDocument,executeCommands,readObjects,SpatialRelationshipCommandPort,type WhiteboardObject} from '@repo/whiteboard-core';
import {CollaborativeEditor} from '@/components/whiteboard/collaborative-editor';
vi.mock('@/components/whiteboard/board-comments',()=>({listBoardMentionableMembers:async()=>[],listBoardCommentThreads:async()=>[]}));
vi.mock('@/components/whiteboard/fabric/board-fabric-surface',()=>({BoardFabricSurface:()=> <div data-testid="board-fabric-surface"/>}));
globalThis.ResizeObserver=class{observe(){}disconnect(){}} as unknown as typeof ResizeObserver;
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
class Input extends MouseEvent{readonly pointerId=1;}
it.each(['Enter','doubleclick'] as const)('actual editor free draft keeps waypoints when final click hits a node port: %s',completion=>{
 vi.stubGlobal('PointerEvent',Input);const doc=createWhiteboardDocument();
 const target:WhiteboardObject={id:'target',schemaVersion:1,kind:'sticky',geometry:{x:600,y:320,width:160,height:100,rotation:0},text:'Target',style:{},parentId:null,orderKey:'target'};
 executeCommands(doc,[{type:'create',object:target}],'fixture');const dispatch=vi.spyOn(SpatialRelationshipCommandPort.prototype,'dispatch');
 try{
  render(<CollaborativeEditor boardId="free-port" clientId="client" doc={doc} readOnly={false} title="Free" status="Connected"/>);
  fireEvent.click(screen.getByTestId('board-add-connector'));fireEvent.click(screen.getByTestId('board-connector-free'));
  const editor=screen.getByTestId('collaborative-editor');vi.spyOn(editor,'getBoundingClientRect').mockReturnValue({left:0,top:0,x:0,y:0,width:1000,height:700,right:1000,bottom:700,toJSON(){return {};}});
  const surface=screen.getByTestId('board-fabric-surface');
  const input=(element:Element,type:string,x:number,y:number)=>fireEvent(element,new Input(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y}));
  act(()=>input(surface,'pointerdown',200,220));act(()=>input(surface,'pointerdown',420,180));
  const port=screen.getByTestId('connector-handle-target-top');
  act(()=>input(port,'pointerdown',680,320));
  expect(dispatch).not.toHaveBeenCalled();
  if(completion==='Enter')fireEvent.keyDown(editor,{key:'Enter'});else fireEvent.doubleClick(port);
  expect(dispatch).toHaveBeenCalledOnce();const edge=readObjects(doc).find(object=>object.kind==='connector')!;
  expect(edge.connector).toMatchObject({type:'free',fromPoint:{x:200,y:220},to:'target',toAnchor:'top',route:{kind:'free',waypoints:[{x:420,y:180}]}});expect(edge.connector).not.toHaveProperty('toPoint');
 }finally{cleanup();doc.destroy();}
});
