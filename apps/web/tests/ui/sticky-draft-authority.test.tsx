import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ThinkingInputEditor } from "@/components/whiteboard/thinking-input-editor";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

const object: BoardFabricObject = { id: "sticky-draft", kind: "sticky", revision: 1, orderKey: "a", geometry: { x: 100, y: 120, width: 180, height: 180, rotation: 30 }, sticky: { variant: "circle", sizingMode: "fixed" }, style: { fill: "#FFE89A", textColor: "#222222", fontSize: 20 }, content: { text: "original" } };
const viewport = { zoom: 1, panX: 0, panY: 0, fitRequest: 0 };

it("keeps an unsent local draft through remote text, and preserves a rejected commit", () => {
  vi.useFakeTimers();
  const preserve = vi.fn(), live = vi.fn(() => true), commit = vi.fn(() => false);
  const props = { object, viewport, readOnly: false, onLiveCommit: live, onCommit: commit, onCancel: vi.fn(), onContinue: vi.fn(), onPreserveDraft: preserve };
  const view = render(<ThinkingInputEditor {...props} initialValue="original" />);
  try {
    const input = screen.getByTestId("board-thinking-editor");
    fireEvent.change(input, { target: { value: "unsent local 中文" } });
    view.rerender(<ThinkingInputEditor {...props} initialValue="remote accepted" />);
    expect(input).toHaveValue("unsent local 中文");
    expect(live).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(commit).toHaveBeenCalledWith("unsent local 中文", "enter");
    expect(preserve).toHaveBeenCalledWith("unsent local 中文");
    expect(object.geometry).toEqual({ x: 100, y: 120, width: 180, height: 180, rotation: 30 });
  } finally { view.unmount(); vi.useRealTimers(); }
});

it("preserves pending input when access is revoked without dispatching its debounce", () => {
  vi.useFakeTimers();
  const preserve = vi.fn(), live = vi.fn(() => true), cancel = vi.fn();
  const props = { object, viewport, onLiveCommit: live, onCommit: vi.fn(() => false), onCancel: cancel, onContinue: vi.fn(), onPreserveDraft: preserve };
  const view = render(<ThinkingInputEditor {...props} initialValue="original" readOnly={false} />);
  try {
    fireEvent.change(screen.getByTestId("board-thinking-editor"), { target: { value: "revoked draft" } });
    view.rerender(<ThinkingInputEditor {...props} initialValue="original" readOnly />);
    expect(preserve).toHaveBeenCalledWith("revoked draft");
    expect(cancel).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(live).not.toHaveBeenCalled();
  } finally { view.unmount(); vi.useRealTimers(); }
});

it("does not submit Enter during synthetic composition and reports rejected composed input", () => {
  const preserve = vi.fn(), live = vi.fn(() => false), commit = vi.fn(() => false);
  const view = render(<ThinkingInputEditor object={object} viewport={viewport} initialValue="original" readOnly={false} onLiveCommit={live} onCommit={commit} onCancel={vi.fn()} onContinue={vi.fn()} onPreserveDraft={preserve} />);
  const input = screen.getByTestId("board-thinking-editor");
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "中文组成" } });
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true, isComposing: true });
  expect(commit).not.toHaveBeenCalled(); expect(live).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input, { data: "中文组成" });
  expect(live).toHaveBeenCalledTimes(1);
  expect(preserve).toHaveBeenCalledWith("中文组成");
  view.unmount();
});
