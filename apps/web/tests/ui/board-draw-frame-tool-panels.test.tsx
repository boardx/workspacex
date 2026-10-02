import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { BoardDrawToolPanel, type BoardDrawAppearance, type BoardDrawChoice } from "@/components/whiteboard/board-draw-tool-panel";
import { BoardFrameToolPanel, type BoardFrameChoice, type BoardFrameDimensions } from "@/components/whiteboard/board-frame-tool-panel";
import type { PanelMode } from "@repo/whiteboard-core";
import { drawingChoiceStyle, drawingToolStyle } from "@/components/whiteboard/drawing-tool-style";

function DrawHarness({onChoice=vi.fn()}:{onChoice?:(choice:BoardDrawChoice)=>void}) {
  const [choice,setChoice]=useState<BoardDrawChoice>("pen");
  const [appearance,setAppearance]=useState<BoardDrawAppearance>({width:3,opacity:1,color:"#18181B"});
  return <BoardDrawToolPanel choice={choice} appearance={appearance} readOnly={false} onChoiceChange={(next)=>{setChoice(next);onChoice(next);}} onAppearanceChange={setAppearance} onSelect={vi.fn()} onClose={vi.fn()}/>;
}

function FrameHarness({onChoice=vi.fn()}:{onChoice?:(choice:BoardFrameChoice,mode:PanelMode)=>void}) {
  const [choice,setChoice]=useState<BoardFrameChoice>("rectangle");
  const [dimensions,setDimensions]=useState<BoardFrameDimensions>({width:960,height:640,size:"m"});
  return <BoardFrameToolPanel choice={choice} dimensions={dimensions} readOnly={false} onChoiceChange={(next,mode)=>{setChoice(next);onChoice(next,mode);}} onDimensionsChange={setDimensions} onClose={vi.fn()}/>;
}

it("offers all drawing instruments and keeps stroke appearance controls stateful",()=>{
  const onChoice=vi.fn();
  render(<DrawHarness onChoice={onChoice}/>);
  expect(screen.getByTestId("board-draw-tool-panel")).toHaveClass("h-[8.5rem]","w-[min(47.5rem,calc(100vw-2rem))]","bg-card","border-border");
  expect(screen.getByTestId("board-draw-tool-panel")).not.toHaveClass("bg-card/98","backdrop-blur");
  for(const name of ["Pen","Marker","Pencil","Highlighter","Eraser"]) expect(screen.getByRole("button",{name})).toBeVisible();
  fireEvent.click(screen.getByTestId("board-draw-pencil"));
  expect(onChoice).toHaveBeenCalledWith("pencil");
  expect(screen.getByTestId("board-draw-pencil")).toHaveAttribute("aria-pressed","true");
  fireEvent.click(screen.getByTestId("board-draw-stroke-8"));
  expect(screen.queryByText("Opacity")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("board-draw-color-2563eb"));
  expect(screen.getByTestId("board-draw-stroke-8")).toHaveAttribute("aria-pressed","true");
  expect(screen.getByTestId("board-draw-color-2563eb")).toHaveAttribute("aria-pressed","true");
  expect(screen.getByTestId("board-draw-preview-pencil")).toHaveStyle({backgroundColor:"#2563EB",height:"8px",opacity:.65});
});

it("uses the selected instrument defaults rather than inherited opaque pen state",()=>{
  const onAppearance=vi.fn();
  render(<BoardDrawToolPanel choice="pen" appearance={{width:3,opacity:1,color:"#18181B"}} readOnly={false} onChoiceChange={vi.fn()} onAppearanceChange={onAppearance} onSelect={vi.fn()} onClose={vi.fn()}/>);
  fireEvent.click(screen.getByTestId("board-draw-highlighter"));
  expect(onAppearance).toHaveBeenCalledWith({width:20,opacity:.35,color:"#FACC15"});
  fireEvent.click(screen.getByTestId("board-draw-pencil"));
  expect(onAppearance).toHaveBeenLastCalledWith({width:2,opacity:.65,color:"#52525B"});
});

it("previews the same instrument color and alpha that the recorder receives",()=>{
  render(<DrawHarness/>);
  for(const choice of ["pen","marker","pencil","highlighter"] as const){
    const style=drawingChoiceStyle(choice);
    expect(screen.getByTestId(`board-draw-preview-${choice}`)).toHaveStyle({backgroundColor:style.color,opacity:style.opacity});
  }
  expect(drawingChoiceStyle("highlighter")).toEqual(drawingToolStyle("highlighter"));
  expect(new Set(["pen","marker","pencil","highlighter"].map(choice=>JSON.stringify(drawingChoiceStyle(choice as BoardDrawChoice)))).size).toBe(4);
});

it("keeps highlighter alpha when adjusting width/color and blocks read-only edits",()=>{
  const onAppearance=vi.fn(),onChoice=vi.fn();
  const props={choice:"highlighter" as const,appearance:drawingChoiceStyle("highlighter"),onAppearanceChange:onAppearance,onChoiceChange:onChoice,onSelect:vi.fn(),onClose:vi.fn()};
  const {rerender}=render(<BoardDrawToolPanel {...props} readOnly={false}/>);
  fireEvent.click(screen.getByTestId("board-draw-stroke-8"));
  expect(onAppearance).toHaveBeenLastCalledWith({...props.appearance,width:8});
  fireEvent.click(screen.getByTestId("board-draw-color-ef4444"));
  expect(onAppearance).toHaveBeenLastCalledWith({...props.appearance,color:"#EF4444"});
  onAppearance.mockClear();rerender(<BoardDrawToolPanel {...props} readOnly/>);
  fireEvent.click(screen.getByTestId("board-draw-pen"));
  fireEvent.click(screen.getByTestId("board-draw-stroke-3"));
  fireEvent.click(screen.getByTestId("board-draw-color-2563eb"));
  expect(onAppearance).not.toHaveBeenCalled();expect(onChoice).not.toHaveBeenCalled();
});

it("shows the renderer's fixed eraser width without offering ineffective width choices",()=>{
  render(<BoardDrawToolPanel choice="eraser" appearance={drawingChoiceStyle("eraser")} readOnly={false} onChoiceChange={vi.fn()} onAppearanceChange={vi.fn()} onSelect={vi.fn()} onClose={vi.fn()}/>);
  expect(screen.getByLabelText("Eraser width")).toHaveTextContent("24px");
  expect(screen.queryByTestId("board-draw-stroke-3")).not.toBeInTheDocument();
  expect(screen.queryByTestId("board-draw-stroke-8")).not.toBeInTheDocument();
  expect(screen.queryByTestId("board-draw-stroke-20")).not.toBeInTheDocument();
});

it("maps frame choices to canonical modes and exposes preset and custom sizes",()=>{
  const onChoice=vi.fn();
  render(<FrameHarness onChoice={onChoice}/>);
  expect(screen.getByTestId("board-frame-tool-panel")).toHaveClass("min-h-[21.25rem]","w-[min(24rem,calc(100vw-2rem))]","bg-card","border-border","shadow-2xl","p-4");
  expect(screen.getByTestId("board-frame-tool-panel")).not.toHaveClass("bg-card/98","backdrop-blur");
  fireEvent.click(screen.getByTestId("board-frame-grid"));
  expect(onChoice).toHaveBeenCalledWith("grid","grid");
  fireEvent.click(screen.getByTestId("board-frame-size-l"));
  expect(screen.getByTestId("board-frame-size-l")).toHaveAttribute("aria-pressed","true");
  fireEvent.click(screen.getByTestId("board-frame-size-custom"));
  fireEvent.change(screen.getByRole("spinbutton",{name:"Frame width"}),{target:{value:"1440"}});
  expect(screen.getByTestId("board-frame-size-custom")).toHaveAttribute("aria-pressed","true");
  expect(screen.getByRole("spinbutton",{name:"Frame width"})).toHaveValue(1440);
});
