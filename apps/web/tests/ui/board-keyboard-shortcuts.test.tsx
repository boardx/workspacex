import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, executeCommands, readObjects } from "@repo/whiteboard-core";
import { CollaborativeThinkingEditor } from "@/components/whiteboard/collaborative-thinking-editor";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

const probe = vi.hoisted(() => ({ tool: "", selection: [] as string[] }));
vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({
  BoardFabricSurface: ({ objects, tool, onSelectionChange, onCanvasClick, selectedObjectIds }: { selectedObjectIds: readonly string[]; objects: readonly BoardFabricObject[]; tool: string; onCanvasClick: (point:{x:number;y:number})=>void; onSelectionChange: (ids: readonly string[], source: "canvas") => void }) => {
    probe.tool = tool; probe.selection = [...selectedObjectIds];
    return <div data-testid="board-fabric-surface" tabIndex={0}><button data-testid="canvas-click" onClick={()=>onCanvasClick({x:200,y:240})}>place</button><button data-testid="select-all" onClick={() => onSelectionChange(objects.map((object) => object.id), "canvas")}>select</button></div>;
  },
}));
class ResizeObserverMock { observe() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
afterEach(cleanup);
function boardKey(event: {key:string;ctrlKey?:boolean;shiftKey?:boolean}) {
  const canvas=screen.getByTestId("canvas-click");canvas.focus();expect(document.activeElement).toBe(canvas);fireEvent.keyDown(canvas,event);
}
const createOnce=(doc:ReturnType<typeof createWhiteboardDocument>,key:string)=>{const count=readObjects(doc).length;boardKey({key});expect(readObjects(doc)).toHaveLength(count);fireEvent.click(screen.getByTestId('canvas-click'));expect(readObjects(doc)).toHaveLength(count+1);expect(probe.tool).toBe('select');};

it("maps authoring shortcuts to canonical object creation and tool state without firing in an input", () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.keyDown(document.body, {key:"n"});fireEvent.click(screen.getByTestId("canvas-click"));expect(readObjects(doc)).toHaveLength(0);
  createOnce(doc,'n');
  fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  createOnce(doc,'t');
  fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  createOnce(doc,'s');
  expect(new Set(readObjects(doc).map((object) => object.kind))).toEqual(new Set(["sticky", "text", "rectangle"]));
  boardKey( { key: "p" }); expect(probe.tool).toBe("draw-pen");
  boardKey( { key: "h" }); expect(probe.tool).toBe("hand");
  boardKey( { key: "v" }); expect(probe.tool).toBe("select");
  const before = readObjects(doc).length;
  fireEvent.pointerDown(screen.getByTestId("board-title-menu"), {button:0,ctrlKey:false,pointerType:"mouse"});
  fireEvent.keyDown(screen.getByLabelText("白板名称"), { key: "n" });
  expect(readObjects(doc)).toHaveLength(before);
  doc.destroy();
});

it("groups a multi-selection through Cmd/Ctrl+G and opens bulk sticky creation with Shift+N", () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  createOnce(doc,'n'); fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  createOnce(doc,'n'); fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  fireEvent.click(screen.getByTestId("select-all"));
  boardKey( { key: "g", ctrlKey: true });
  expect(readObjects(doc).filter((object) => object.kind === "group")).toHaveLength(1);
  boardKey( { key: "n", shiftKey: true });
  expect(screen.getByRole("dialog", { name: "批量创建便利贴" })).toBeVisible();
  doc.destroy();
});

it("copies, pastes, and duplicates canonical selections through standard shortcuts", () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  createOnce(doc,'n'); fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  fireEvent.click(screen.getByTestId("select-all"));
  const original = readObjects(doc)[0]!;
  boardKey( { key: "c", ctrlKey: true });
  boardKey( { key: "v", ctrlKey: true });
  expect(readObjects(doc)).toHaveLength(2);
  expect(readObjects(doc).find((object) => object.id !== original.id)?.geometry).toMatchObject({ x: original.geometry.x + 24, y: original.geometry.y + 24 });
  boardKey( { key: "d", ctrlKey: true });
  expect(readObjects(doc)).toHaveLength(3);
  expect(new Set(readObjects(doc).map((object) => object.id)).size).toBe(3);
  doc.destroy();
});

function selectedWidgetKey(key:string) { const surface=screen.getByTestId('board-fabric-surface');surface.focus();fireEvent.keyDown(surface,{key}); }
it.each(['sticky','rectangle'] as const)('continues selected %s with one connected operation and deletes/undoes its new selection',kind=>{
 const doc=createWhiteboardDocument();executeCommands(doc,[{type:'create',object:{id:'source',schemaVersion:1,kind,geometry:{x:100,y:220,width:80,height:70,rotation:0},text:'',style:{fill:'#22c55e'},parentId:null,orderKey:''}}],{});
 render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
 let updates=0;doc.on('update',()=>{updates++;});
 fireEvent.click(screen.getByTestId('select-all'));selectedWidgetKey('Tab');expect(updates).toBe(1);
 const continued=readObjects(doc),next=continued.find(object=>object.id!=='source'&&object.kind===kind)!;
 expect(next).toBeTruthy();expect(next.style).toEqual(continued.find(object=>object.id==='source')!.style);
 expect(probe.selection).toEqual([next.id]);expect(continued.filter(object=>object.kind==='connector')).toHaveLength(1);
 expect(continued.find(object=>object.kind==='connector')!.connector).toMatchObject({from:'source',to:next.id});
 selectedWidgetKey('Delete');expect(updates).toBe(2);expect(readObjects(doc).map(object=>object.id)).toEqual(['source']);
 boardKey({key:'z',ctrlKey:true});expect(updates).toBe(3);expect(readObjects(doc)).toEqual(continued);
 boardKey({key:'z',ctrlKey:true});expect(updates).toBe(4);expect(readObjects(doc).map(object=>object.id)).toEqual(['source']);
 boardKey({key:'z',ctrlKey:true,shiftKey:true});expect(updates).toBe(5);
 // Redo of creation cannot revive tombstoned IDs; core recreates the entire subgraph.
 const redone=readObjects(doc),edge=continued.find(object=>object.kind==='connector')!;
 const restoredWidget=redone.find(object=>object.restoredFrom===next.id)!;
 const restoredEdge=redone.find(object=>object.restoredFrom===edge.id)!;
 expect(redone).toHaveLength(3);expect(restoredWidget).toBeTruthy();expect(restoredEdge).toBeTruthy();
 expect(new Set(redone.map(object=>object.id)).size).toBe(3);
 expect(redone.some(object=>object.id===next.id||object.id===edge.id)).toBe(false);
 expect(restoredWidget).toEqual({...next,id:restoredWidget.id,restoredFrom:next.id});
 expect(restoredEdge).toEqual({...edge,id:restoredEdge.id,restoredFrom:edge.id,connector:{...edge.connector,to:restoredWidget.id}});
 expect(redone.find(object=>object.id==='source')).toEqual(continued.find(object=>object.id==='source'));
 boardKey({key:'z',ctrlKey:true});expect(updates).toBe(6);expect(readObjects(doc).map(object=>object.id)).toEqual(['source']);doc.destroy();
});
it.each([{readOnly:true,locked:false},{readOnly:false,locked:true}])('rejects Tab/Delete with readonly=$readOnly locked=$locked',({readOnly,locked})=>{
 const doc=createWhiteboardDocument();executeCommands(doc,[{type:'create',object:{id:'source',schemaVersion:1,kind:'rectangle',geometry:{x:100,y:220,width:80,height:70,rotation:0},text:'',style:{},parentId:null,orderKey:'',locked}}],{});
 render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={readOnly} title="Board" status="已连接" />);
 fireEvent.click(screen.getByTestId('select-all'));const before=readObjects(doc);selectedWidgetKey('Tab');selectedWidgetKey('Delete');expect(readObjects(doc)).toEqual(before);doc.destroy();
});
