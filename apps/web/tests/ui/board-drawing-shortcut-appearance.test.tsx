import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument } from "@repo/whiteboard-core";
import { CollaborativeThinkingEditor } from "@/components/whiteboard/collaborative-thinking-editor";
import type { BoardDrawAppearance } from "@/components/whiteboard/board-draw-tool-panel";

vi.mock("@/components/whiteboard/fabric/board-fabric-surface",()=>({BoardFabricSurface:({drawingAppearance,tool}:{drawingAppearance:BoardDrawAppearance;tool:string})=><output data-testid="drawing-surface-state">{JSON.stringify({tool,drawingAppearance})}</output>}));
vi.stubGlobal("ResizeObserver",class{observe(){}disconnect(){}});
afterEach(cleanup);

it.each(["highlighter","pencil"] as const)("P restores the single-source pen appearance after %s",choice=>{
  const doc=createWhiteboardDocument();
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接"/>);
  const editor=screen.getByTestId("collaborative-editor");
  fireEvent.keyDown(editor,{key:"p"});
  fireEvent.click(screen.getByTestId(`board-draw-${choice}`));
  expect(JSON.parse(screen.getByTestId("drawing-surface-state").textContent!).drawingAppearance.opacity).not.toBe(1);
  fireEvent.keyDown(editor,{key:"p"});
  expect(JSON.parse(screen.getByTestId("drawing-surface-state").textContent!)).toEqual({tool:"draw-pen",drawingAppearance:{width:3,opacity:1,color:"#18181B"}});
  doc.destroy();
});
