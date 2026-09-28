import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { BoardDrawToolPanel, type BoardDrawAppearance, type BoardDrawChoice } from "@/components/whiteboard/board-draw-tool-panel";
import { BoardFrameToolPanel, type BoardFrameChoice, type BoardFrameDimensions } from "@/components/whiteboard/board-frame-tool-panel";
import type { PanelMode } from "@repo/whiteboard-core";

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
  for(const name of ["Pen","Marker","Pencil","Highlighter","Eraser"]) expect(screen.getByRole("button",{name})).toBeVisible();
  fireEvent.click(screen.getByTestId("board-draw-pencil"));
  expect(onChoice).toHaveBeenCalledWith("pencil");
  expect(screen.getByTestId("board-draw-pencil")).toHaveAttribute("aria-pressed","true");
  fireEvent.click(screen.getByTestId("board-draw-stroke-8"));
  fireEvent.click(screen.getByTestId("board-draw-opacity-55"));
  fireEvent.click(screen.getByTestId("board-draw-color-2563eb"));
  expect(screen.getByTestId("board-draw-stroke-8")).toHaveAttribute("aria-pressed","true");
  expect(screen.getByTestId("board-draw-opacity-55")).toHaveAttribute("aria-pressed","true");
  expect(screen.getByTestId("board-draw-color-2563eb")).toHaveAttribute("aria-pressed","true");
});

it("maps frame choices to canonical modes and exposes preset and custom sizes",()=>{
  const onChoice=vi.fn();
  render(<FrameHarness onChoice={onChoice}/>);
  fireEvent.click(screen.getByTestId("board-frame-grid"));
  expect(onChoice).toHaveBeenCalledWith("grid","grid");
  fireEvent.click(screen.getByTestId("board-frame-size-l"));
  expect(screen.getByTestId("board-frame-size-l")).toHaveAttribute("aria-pressed","true");
  fireEvent.click(screen.getByTestId("board-frame-size-custom"));
  fireEvent.change(screen.getByRole("spinbutton",{name:"Frame width"}),{target:{value:"1440"}});
  expect(screen.getByTestId("board-frame-size-custom")).toHaveAttribute("aria-pressed","true");
  expect(screen.getByRole("spinbutton",{name:"Frame width"})).toHaveValue(1440);
});
