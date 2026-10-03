import {act,cleanup,render,renderHook,screen} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {connectorPathHandles,createWhiteboardDocument,executeCommands,readObjects,resolveConnectorPath,SpatialRelationshipCommandPort,WhiteboardUndo,
  type WhiteboardObject,type SpatialCommand,type SpatialPrecondition} from "@repo/whiteboard-core";
import {BoardConnectorHandles,type ConnectorOverlayPointerEvent} from "@/components/whiteboard/board-connector-handles";
import {useBoardConnectorGesture} from "@/components/whiteboard/use-board-connector-gesture";

afterEach(cleanup);
const scenes=["elbow-horizontal","elbow-vertical","curve-horizontal","curve-vertical"] as const;
describe("independent connector coincident controls",()=>{
  it.each(scenes.flatMap(scene=>[.5,1,2].map(zoom=>({scene,zoom}))))("keeps all 44px hit rectangles reachable for $scene at $zoom",({scene,zoom})=>{
    const vertical=scene.endsWith("vertical"),type=scene.startsWith("curve")?"curve" as const:"elbow" as const;
    const start={x:100,y:100},end=vertical?{x:100,y:500}:{x:700,y:100};
    const relationship={fromPoint:start,toPoint:end,fromAnchor:"right" as const,toAnchor:"left" as const,type,
      startStyle:"none" as const,endStyle:"arrow" as const,lineStyle:"solid" as const,label:"",semanticRelation:""};
    const path=resolveConnectorPath({...relationship,start,end}),viewport={zoom,panX:20,panY:30,fitRequest:0};
    render(<BoardConnectorHandles viewport={viewport} path={path} relationship={relationship} color="#222" canEdit active={false}
      onPointerDown={vi.fn()} onPointerMove={vi.fn()} onPointerUp={vi.fn()} onPointerCancel={vi.fn()} onLostPointerCapture={vi.fn()}/>);
    const buttons=screen.getAllByRole("button"),centers=buttons.map(button=>({x:parseFloat(button.style.left),y:parseFloat(button.style.top)}));
    for(const [id,point] of [["from",start],["to",end]] as const){
      const endpoint=screen.getByTestId(`board-connector-handle-${id}`);
      expect(parseFloat(endpoint.style.left)).toBe(point.x*zoom+20);
      expect(parseFloat(endpoint.style.top)).toBe(point.y*zoom+30);
    }
    for(let i=0;i<centers.length;i++)for(let j=i+1;j<centers.length;j++){
      expect(Math.abs(centers[i]!.x-centers[j]!.x)>=44||Math.abs(centers[i]!.y-centers[j]!.y)>=44).toBe(true);
    }
    for(const item of connectorPathHandles(path)){
      const button=screen.getByTestId(`board-connector-handle-${item.id}`),x=parseFloat(button.style.left),y=parseFloat(button.style.top);
      const origin={x:item.point.x*zoom+20,y:item.point.y*zoom+30};
      if(x!==origin.x||y!==origin.y){
        const leader=screen.getByTestId(`board-connector-handle-leader-${item.id}`);
        expect(Number(leader.getAttribute("x1"))).toBe(origin.x);expect(Number(leader.getAttribute("y1"))).toBe(origin.y);
        expect(Number(leader.getAttribute("x2"))).toBe(x);expect(Number(leader.getAttribute("y2"))).toBe(y);
      }
    }
  });
  it.each([.5,1,2])("dragging a displaced route button at zoom %s applies pointer delta without jumping",zoom=>{
    const doc=createWhiteboardDocument(),connector={fromPoint:{x:100,y:100},toPoint:{x:700,y:100},fromAnchor:"right" as const,toAnchor:"left" as const,
      type:"curve" as const,route:{kind:"curve" as const,startOffset:{x:200,y:80},endOffset:{x:-200,y:0}},label:""};
    const edge:WhiteboardObject={id:"edge",schemaVersion:1,kind:"connector",geometry:{x:100,y:100,width:600,height:36,rotation:0},
      text:"",style:{},parentId:null,orderKey:"a",connector};
    executeCommands(doc,[{type:"create",object:edge}],{});
    const before=readObjects(doc),undo=new WhiteboardUndo(doc),port=new SpatialRelationshipCommandPort(doc),target=document.createElement("button"),host=document.createElement("section");
    target.setPointerCapture=vi.fn();target.hasPointerCapture=vi.fn(()=>true);target.releasePointerCapture=vi.fn();
    host.getBoundingClientRect=()=>new DOMRect(31,17,1000,800);
    const execute=vi.fn((command:SpatialCommand,preconditions?:SpatialPrecondition[])=>{port.dispatch({boardId:"board",clientId:"independent",gestureId:crypto.randomUUID(),command,preconditions});return true;});
    const hook=renderHook(()=>useBoardConnectorGesture({objects:before,readLiveObjects:()=>readObjects(doc),viewport:{zoom,panX:20,panY:30,fitRequest:0},blocked:false,selectedId:"edge",host:()=>host,execute,onCreated:vi.fn(),onFailure:vi.fn()}));
    const event=(dx:number,dy:number)=>({pointerId:1,currentTarget:target,button:0,clientX:31+20+300*zoom+48+dx,clientY:17+30+180*zoom+dy,
      ctrlKey:false,metaKey:false,preventDefault:vi.fn(),stopPropagation:vi.fn()}) as unknown as ConnectorOverlayPointerEvent;
    try{
      act(()=>hook.result.current.onPointerDown("route","curve-start",event(0,0)));
      act(()=>hook.result.current.onPointerMove(event(20,30)));
      expect(readObjects(doc)).toEqual(before);expect(execute).not.toHaveBeenCalled();
      act(()=>hook.result.current.onPointerUp(event(20,30)));
      expect(execute).toHaveBeenCalledTimes(1);
      const route=readObjects(doc)[0]!.connector!.route;
      expect(route).toMatchObject({kind:"curve",startOffset:{x:200+20/zoom,y:80+30/zoom},endOffset:{x:-200,y:0}});
      expect(undo.undo()).toBe("undone");expect(readObjects(doc)).toEqual(before);
    }finally{hook.unmount();undo.destroy();doc.destroy();}
  });
});
