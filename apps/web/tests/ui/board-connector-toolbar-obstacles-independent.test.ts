// @vitest-environment jsdom
import {createElement} from "react";
import {cleanup,render,screen} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {connectorPathHandles,resolveConnectorPath} from "@repo/whiteboard-core";
import {BoardConnectorHandles} from "@/components/whiteboard/board-connector-handles";
import {boardToolbarPosition,useBoardToolbarPosition} from "@/components/whiteboard/use-board-toolbar-position";

const viewport={zoom:1,panX:0,panY:0,fitRequest:0};
const relationship={fromPoint:{x:100,y:100},toPoint:{x:700,y:100},fromAnchor:"right" as const,toAnchor:"left" as const,
  type:"curve" as const,startStyle:"none" as const,endStyle:"arrow" as const,lineStyle:"solid" as const,label:"",semanticRelation:"",
  route:{kind:"curve" as const,startOffset:{x:200,y:80},endOffset:{x:-200,y:0}}};
const path=resolveConnectorPath({...relationship,start:relationship.fromPoint,end:relationship.toPoint});
const control=connectorPathHandles(path)[0]!.point;
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("independent desktop connector toolbar obstacles",()=>{
  it("already avoids a known control rectangle using its existing obstacle algorithm",()=>{
    const position=boardToolbarPosition(path.bounds,viewport,{width:1000,height:800},{width:430,height:92},
      [{x:control.x-22,y:control.y-22,width:44,height:44}]);
    const left=Number(position.left),top=Number(position.top);
    expect(control.x>=left&&control.x<=left+430&&control.y>=top&&control.y<=top+92).toBe(false);
  });
  it("does not cover the actual rendered route control after measuring desktop DOM geometry",()=>{
    // JSDOM has no layout. Inject measured desktop rectangles, not a browser hit-test claim.
    vi.stubGlobal("ResizeObserver",class{observe(){}disconnect(){}});
    vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(function(this:HTMLElement){
      if(this.dataset.testid==="collaborative-editor")return new DOMRect(0,0,1000,800);
      if(this.dataset.testid==="independent-toolbar")return new DOMRect(parseFloat(this.style.left)||0,parseFloat(this.style.top)||0,430,92);
      if(this.dataset.testid?.startsWith("board-connector-handle-"))return new DOMRect(parseFloat(this.style.left)-22,parseFloat(this.style.top)-22,44,44);
      return new DOMRect();
    });
    function Fixture({currentPath=path,layoutKey="selected-curve-revision-1"}:{currentPath?:typeof path;layoutKey?:string}){
      const controlAwareHook=useBoardToolbarPosition as (geometry:typeof path.bounds,view:typeof viewport,controlLayoutKey:string)=>ReturnType<typeof useBoardToolbarPosition>;
      const toolbar=controlAwareHook(currentPath.bounds,viewport,layoutKey);
      return createElement("section",{"data-testid":"collaborative-editor"},
        createElement(BoardConnectorHandles,{viewport,path:currentPath,relationship,color:"#222",canEdit:true,active:false,
          onPointerDown:vi.fn(),onPointerMove:vi.fn(),onPointerUp:vi.fn(),onPointerCancel:vi.fn(),onLostPointerCapture:vi.fn()}),
        createElement("div",{ref:toolbar.ref,"data-testid":"independent-toolbar",style:toolbar.style}));
    }
    const view=render(createElement(Fixture));
    const assertClear=()=>{
      const route=screen.getByTestId("board-connector-handle-curve-start").getBoundingClientRect();
      const toolbar=screen.getByTestId("independent-toolbar").getBoundingClientRect();
      const center={x:route.x+route.width/2,y:route.y+route.height/2};
      expect(center.x>=toolbar.left&&center.x<=toolbar.right&&center.y>=toolbar.top&&center.y<=toolbar.bottom).toBe(false);
    };
    assertClear();
    const changed=resolveConnectorPath({...relationship,start:relationship.fromPoint,end:relationship.toPoint,
      route:{...relationship.route,startOffset:{x:200,y:140}}});
    view.rerender(createElement(Fixture,{currentPath:changed,layoutKey:"selected-curve-revision-2"}));
    assertClear();
  });
});
