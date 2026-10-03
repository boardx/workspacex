import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBoardConnectorGesture } from "@/components/whiteboard/use-board-connector-gesture";
import type { ConnectorOverlayPointerEvent } from "@/components/whiteboard/board-connector-handles";
import type { ConnectorRelationship, SpatialCommand, WhiteboardObject } from "@repo/whiteboard-core";

const before: ConnectorRelationship = { fromPoint: { x: 10, y: 20 }, toPoint: { x: 10, y: 20 }, fromAnchor: "right", toAnchor: "left", type: "straight", startStyle: "none", endStyle: "arrow", lineStyle: "solid", label: "", semanticRelation: "" };
function setup() {
  const target = document.createElement("button"), host = document.createElement("div"), execute = vi.fn((_command: SpatialCommand) => true), created = vi.fn(), failure = vi.fn();
  target.setPointerCapture = vi.fn(); target.hasPointerCapture = vi.fn(() => true); target.releasePointerCapture = vi.fn();
  const props = { objects: [] as WhiteboardObject[], viewport: { zoom: 1, panX: 0, panY: 0, fitRequest: 0 }, blocked: false, selectedId: null, host: () => host, execute, onCreated: created, onFailure: failure };
  const hook = renderHook(input => useBoardConnectorGesture(input), { initialProps: props });
  const event = (x: number, y: number, pointerId = 1) => ({ currentTarget: target, pointerId, clientX: x, clientY: y, button: 0, metaKey: false, ctrlKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as ConnectorOverlayPointerEvent;
  return { ...hook, props, event, execute, created, failure };
}
describe("connector pointer session", () => {
  it.each([false, true])("preserves deliberate free movement instead of stale snap intent (leave=%s)", leave => {
    const test = setup();
    const target: WhiteboardObject = { id: "target", schemaVersion: 1, kind: "sticky", geometry: { x: 150, y: 60, width: 100, height: 80, rotation: 0 }, text: "", style: {}, parentId: null, orderKey: "a" };
    let live = [target];
    test.rerender({ ...test.props, objects: [target], readLiveObjects: () => live } as typeof test.props);
    act(() => test.result.current.beginCreation(before, test.event(10, 20)));
    act(() => test.result.current.onPointerMove(test.event(150, 100)));
    expect(test.result.current.relationship?.to).toBe("target");
    if (leave) act(() => test.result.current.onPointerMove(test.event(400, 250)));
    live = [{ ...target, locked: true }];
    act(() => test.result.current.onPointerUp(test.event(leave ? 400 : 150, leave ? 250 : 100)));
    expect(test.execute).toHaveBeenCalledTimes(leave ? 1 : 0);
    if (leave) expect(test.execute.mock.calls[0]?.[0]).toMatchObject({ relationship: { toPoint: { x: 400, y: 250 } } });
    expect(test.result.current.active).toBe(false);
    test.unmount();
  });
  it("takes keyboard ownership by focusing the board after a real accepted pointer gesture", () => {
    const test = setup(), host = test.props.host();
    host.tabIndex = -1; document.body.append(host);
    try {
      act(() => test.result.current.beginCreation(before, test.event(10, 20)));
      expect(document.activeElement).toBe(host);
    } finally { test.unmount(); host.remove(); }
  });
  it("previews with zero writes and commits one free connector on release only", () => {
    const test = setup();
    act(() => test.result.current.beginCreation(before, test.event(10, 20)));
    act(() => test.result.current.onPointerMove(test.event(150, 100)));
    expect(test.execute).not.toHaveBeenCalled(); expect(test.result.current.path?.end).toEqual({ x: 150, y: 100 });
    act(() => test.result.current.onPointerUp(test.event(150, 100)));
    act(() => test.result.current.onPointerUp(test.event(150, 100)));
    expect(test.execute).toHaveBeenCalledTimes(1); expect(test.execute.mock.calls[0]?.[0]).toMatchObject({ type: "create-connector", relationship: { fromPoint: { x: 10, y: 20 }, toPoint: { x: 150, y: 100 } } });
    expect(test.created).toHaveBeenCalledTimes(1); expect(test.result.current.active).toBe(false);
  });
  it("cancels before a late release after permission revocation or Escape", () => {
    const test = setup();
    act(() => test.result.current.beginCreation(before, test.event(10, 20)));
    act(() => test.result.current.onPointerMove(test.event(150, 100)));
    test.rerender({ ...test.props, blocked: true });
    act(() => test.result.current.onPointerUp(test.event(150, 100)));
    expect(test.execute).not.toHaveBeenCalled();
    test.rerender(test.props);
    act(() => test.result.current.beginCreation(before, test.event(10, 20)));
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    act(() => test.result.current.onPointerUp(test.event(150, 100)));
    expect(test.execute).not.toHaveBeenCalled();
  });
  it("ignores a second pointer and zero-distance release", () => {
    const test = setup();
    act(() => test.result.current.beginCreation(before, test.event(10, 20)));
    act(() => test.result.current.onPointerMove(test.event(150, 100, 2)));
    act(() => test.result.current.onPointerUp(test.event(10, 20)));
    expect(test.execute).not.toHaveBeenCalled(); expect(test.result.current.active).toBe(false);
  });
});
