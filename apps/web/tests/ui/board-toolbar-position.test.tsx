import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument } from "@repo/whiteboard-core";
import { CollaborativeThinkingEditor } from "@/components/whiteboard/collaborative-thinking-editor";
import { boardToolbarPosition, useBoardToolbarPosition } from "@/components/whiteboard/use-board-toolbar-position";
import { BoardToolPopover } from "@/components/whiteboard/board-tool-popover";
import type { BoardViewport } from "@/components/whiteboard/fabric/board-fabric-object";

let camera: BoardViewport;
vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({ BoardFabricSurface: ({ onViewportChange,onCanvasClick }: { onCanvasClick:(point:{x:number;y:number})=>void;onViewportChange: (viewport: BoardViewport) => void }) => <><button data-testid="test-create" onClick={()=>onCanvasClick({x:400,y:300})}>place</button><button data-testid="test-camera" onClick={() => onViewportChange(camera)}>camera</button></> }));
class ResizeObserverMock { observe() {} disconnect() {} }
beforeEach(() => { vi.stubGlobal("ResizeObserver", ResizeObserverMock); vi.stubGlobal("innerWidth", 1024); vi.stubGlobal("innerHeight", 768); camera = { zoom: 1, panX: 0, panY: 0, fitRequest: 0 }; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps selection compact until properties are opened, then keyboard-resizes the inspector", () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.click(screen.getByTestId("board-add-sticky"));
  fireEvent.click(screen.getByTestId("test-create"));
  const panel = screen.getByTestId("board-context-toolbar");
  expect(panel).toHaveAttribute("data-board-selected-object-panel", "true");
  expect(panel).toHaveAttribute("data-expanded", "false");
  expect(panel).toHaveClass("max-w-[min(27rem,calc(100vw-2rem))]");
  expect(screen.getByTestId("board-inspector-expand")).toBeVisible();
  expect(screen.getByTestId("board-inspector-close")).toBeVisible();
  fireEvent.click(screen.getByTestId("board-inspector-expand"));
  expect(panel.style.left).toMatch(/px$/);
  expect(panel.style.top).toMatch(/px$/);
  const resize = screen.getByTestId("board-inspector-resize");
  fireEvent.keyDown(resize, { key: "ArrowLeft" });
  expect(resize).toHaveAttribute("aria-valuenow", "296");
  fireEvent.click(screen.getByTestId("board-inspector-close"));
  expect(screen.queryByTestId("board-context-toolbar")).toBeNull();
  doc.destroy();
});

it("places the full measured toolbar above an object or below it when the header prevents that", () => {
  const viewport = { zoom: 1, panX: 0, panY: 0, fitRequest: 0 };
  const object = { x: 400, y: 300, width: 180, height: 180 };
  const size = { width: 1024, height: 768 }, toolbar = { width: 370, height: 54 };
  const above = boardToolbarPosition(object, viewport, size, toolbar);
  expect(Number(above.top) + toolbar.height).toBeLessThan(object.y);
  const below = boardToolbarPosition({ ...object, y: 80 }, viewport, size, toolbar);
  expect(Number(below.top)).toBeGreaterThan(80 + object.height);
});

const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const controls = [{ x: 16, y: 64, width: 264, height: 54 }, { x: 16, y: 128, width: 264, height: 54 }];
it.each([{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }])("keeps Fit/Undo and object text clear in $width × $height", (size) => {
  const geometry = { x: 160, y: 200, width: 320, height: 96 }, viewport = { zoom: 1, panX: 0, panY: 0, fitRequest: 0 };
  const style = boardToolbarPosition(geometry, viewport, size, { width: 440, height: 54 }, controls);
  const rect = { x: Number(style.left), y: Number(style.top), width: 440, height: 54 };
  for (const obstacle of [...controls, geometry]) expect(intersects(rect, obstacle)).toBe(false);
});

it.each([{width:1440,height:900},{width:390,height:844}])('reserves measured above submenu space without crossing the dock at $width',size=>{
 const viewport={zoom:1,panX:0,panY:0,fitRequest:0};
 const toolbar={width:350,height:54};
 for(const contentHeight of [180,1200]){
  const style=boardToolbarPosition({x:100,y:0,width:80,height:20},viewport,size,toolbar,[],contentHeight);
  expect(Number(style.top)).toBeGreaterThanOrEqual(72+12+Math.min(contentHeight,size.height-112-54-72-12));
  expect(Number(style.top)+toolbar.height).toBeLessThanOrEqual(size.height-112);
 }
});

function SubmenuToolbar({label,shown=true}:{label:string;shown?:boolean}){
 const position=useBoardToolbarPosition({x:100,y:0,width:80,height:20},{zoom:1,panX:0,panY:0,fitRequest:0});
 return <section ref={position.ref} style={position.style} data-testid="reserved-toolbar">{shown&&<BoardToolPopover label={label} placement="above" trigger={<button data-testid="reserved-trigger">Open</button>}><button>Action</button></BoardToolPopover>}</section>;
}

function SwitchingSubmenuToolbar(){
 const position=useBoardToolbarPosition({x:100,y:0,width:80,height:20},{zoom:1,panX:0,panY:0,fitRequest:0});
 return <section ref={position.ref} style={position.style} data-testid="reserved-toolbar">{['first','second'].map(name=><BoardToolPopover key={name} label={name} placement="above" trigger={<button data-testid={name}>Open {name}</button>}><button>Action {name}</button></BoardToolPopover>)}</section>;
}

it('switches actual open popovers and releases the final reservation on close',()=>{
 vi.spyOn(HTMLElement.prototype,'scrollHeight','get').mockImplementation(function(this:HTMLElement){return this.classList.contains('p-4')?180:0;});
 render(<SwitchingSubmenuToolbar/>);
 const toolbar=screen.getByTestId('reserved-toolbar');
 const ordinary=toolbar.style.top;
 for(const name of ['first','second']){
  const trigger=screen.getByTestId(name);
  vi.spyOn(trigger,'getBoundingClientRect').mockImplementation(()=>{
   const top=Number.parseFloat(toolbar.style.top);
   return {left:100,top,bottom:top+44,right:144,x:100,y:top,width:44,height:44,toJSON:()=>({})};
  });
  fireEvent.click(trigger);
  expect(Number.parseFloat(toolbar.style.top)).toBeGreaterThanOrEqual(264);
  expect(screen.getAllByRole('dialog',{hidden:true})).toHaveLength(1);
 }
 fireEvent.click(screen.getByRole('button',{name:'关闭second'}));
 expect(toolbar.style.top).toBe(ordinary);
});

it.each(['连接线路径','连接线粗细','连接线型','端点样式','连接标签'])('only moves the owning %s toolbar and restores ordinary positioning when the submenu closes',label=>{
 render(<SubmenuToolbar label={label}/>);
 const toolbar=screen.getByTestId('reserved-toolbar'),trigger=screen.getByTestId('reserved-trigger');
 const ordinary=toolbar.style.top;
 fireEvent(window,new CustomEvent('board-inspector-space',{detail:{trigger:document.body,height:180}}));
 expect(toolbar.style.top).toBe(ordinary);
 fireEvent(window,new CustomEvent('board-inspector-space',{detail:{trigger,height:180}}));
 expect(Number.parseFloat(toolbar.style.top)).toBeGreaterThanOrEqual(264);
 fireEvent(window,new CustomEvent('board-inspector-space',{detail:{trigger,height:0}}));
 expect(toolbar.style.top).toBe(ordinary);
});

it.each(['连接线路径','连接线粗细','连接线型','端点样式','连接标签'])('opens the actual managed %s popover and releases its reservation on removal',label=>{
 vi.spyOn(HTMLElement.prototype,'scrollHeight','get').mockImplementation(function(this:HTMLElement){return this.classList.contains('p-4')?180:0;});
 const view=render(<SubmenuToolbar label={label}/>);
 const toolbar=screen.getByTestId('reserved-toolbar'),trigger=screen.getByTestId('reserved-trigger');
 const ordinary=toolbar.style.top;
 vi.spyOn(trigger,'getBoundingClientRect').mockImplementation(()=>{
  const top=Number.parseFloat(toolbar.style.top);
  return {left:100,top,bottom:top+44,right:144,x:100,y:top,width:44,height:44,toJSON:()=>({})};
 });
 fireEvent.click(trigger);
 expect(screen.getByRole('dialog',{hidden:true})).toHaveAttribute('data-board-popover-placement','above');
 expect(Number.parseFloat(toolbar.style.top)).toBeGreaterThanOrEqual(264);
 fireEvent(window,new Event('resize'));
 expect(screen.getByRole('dialog')).toHaveStyle({maxHeight:'184px'});
 view.rerender(<SubmenuToolbar label={label} shown={false}/>);
 expect(screen.queryByRole('dialog')).toBeNull();
 expect(trigger.isConnected).toBe(false);
 expect(toolbar.style.top).toBe(ordinary);
});

it('does not let a detached previous owner clear a newer popover reservation',()=>{
 render(<SubmenuToolbar label="连接线路径"/>);
 const toolbar=screen.getByTestId('reserved-toolbar'),first=screen.getByTestId('reserved-trigger');
 const second=document.createElement('button');toolbar.append(second);
 fireEvent(window,new CustomEvent('board-inspector-space',{detail:{trigger:first,height:180}}));
 fireEvent(window,new CustomEvent('board-inspector-space',{detail:{trigger:second,height:240}}));
 const current=toolbar.style.top;
 fireEvent(window,new CustomEvent('board-inspector-space',{detail:{trigger:first,height:0}}));
 expect(toolbar.style.top).toBe(current);
 second.remove();
 fireEvent(window,new CustomEvent('board-inspector-space',{detail:{trigger:second,height:0}}));
 expect(Number.parseFloat(toolbar.style.top)).toBe(72);
});
