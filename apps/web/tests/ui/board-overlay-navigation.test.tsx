import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { expect, it, vi } from "vitest";
import { useBoardOverlayNavigation } from "@/components/whiteboard/use-board-overlay-navigation";

function Harness({ changed = vi.fn() }: { changed?: ReturnType<typeof vi.fn> }) {
  const [viewport, setViewport] = useState({ zoom: 2, panX: 12, panY: -8, fitRequest: 0 });
  const host = useRef<HTMLElement>(null);
  const navigation = useBoardOverlayNavigation(viewport, next => { changed(next); setViewport(next); }, host);
  return <section ref={host} {...navigation.events} data-testid="stage">
    <div data-testid="board-connector-handles"><button data-testid="overlay">endpoint</button><input data-testid="input"/><div contentEditable data-testid="editable"/></div>
    <button data-testid="connector-handle-node-right">node anchor</button>
    <button data-testid="menu">menu</button>
    <output data-testid="viewport">{JSON.stringify(viewport)}</output>
  </section>;
}

const point = (button: number, x: number, y: number) => ({ pointerId: 7, button, clientX: x, clientY: y });

it.each([1, 2])("pans over Connector overlay using button %s and keeps zoom", button => {
  render(<Harness />);
  fireEvent.pointerDown(screen.getByTestId("overlay"), point(button, 20, 30));
  fireEvent.pointerMove(screen.getByTestId("overlay"), point(button, 60, 55));
  expect(JSON.parse(screen.getByTestId("viewport").textContent!)).toMatchObject({ zoom: 2, panX: 52, panY: 17 });
  fireEvent.pointerUp(screen.getByTestId("overlay"), point(button, 60, 55));
  fireEvent.pointerMove(screen.getByTestId("overlay"), point(button, 100, 100));
  expect(JSON.parse(screen.getByTestId("viewport").textContent!)).toMatchObject({ panX: 52, panY: 17 });
});

it("handles overlay wheel exactly once with a cancellable native listener", () => {
  const changed = vi.fn();
  render(<Harness changed={changed} />);
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 31, deltaY: 48 });
  act(() => screen.getByTestId("overlay").dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(JSON.parse(screen.getByTestId("viewport").textContent!)).toMatchObject({ zoom: 2, panX: -19, panY: -56 });
});

it.each(["ctrlKey", "metaKey"])("anchors overlay %s zoom to the stage-relative scene point", modifier => {
  render(<Harness />);
  vi.spyOn(screen.getByTestId("stage"), "getBoundingClientRect").mockReturnValue({ left: 100, top: 50, width: 1000, height: 700 } as DOMRect);
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 300, clientY: 150, deltaY: -80, [modifier]: true });
  act(() => screen.getByTestId("connector-handle-node-right").dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  const next = JSON.parse(screen.getByTestId("viewport").textContent!);
  expect(next.zoom).toBeGreaterThan(2);
  expect((200-next.panX)/next.zoom).toBeCloseTo(94);
  expect((100-next.panY)/next.zoom).toBeCloseTo(54);
});

it("leaves menu and editable overlay wheel unchanged", () => {
  const changed = vi.fn();
  render(<Harness changed={changed} />);
  for (const id of ["menu", "input", "editable"]) {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -80 });
    act(() => screen.getByTestId(id).dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
  }
  expect(changed).not.toHaveBeenCalled();
});

it("normalizes line/page wheel units and uses the same 5%-800% zoom limits", () => {
  render(<Harness />);
  const overlay = screen.getByTestId("overlay");
  fireEvent.wheel(overlay, { deltaX: 1, deltaY: 2, deltaMode: 1 });
  expect(JSON.parse(screen.getByTestId("viewport").textContent!)).toMatchObject({ zoom: 2, panX: -4, panY: -40 });
  vi.spyOn(screen.getByTestId("stage"), "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 700 } as DOMRect);
  fireEvent.wheel(overlay, { deltaX: 0, deltaY: 1, deltaMode: 2 });
  expect(JSON.parse(screen.getByTestId("viewport").textContent!)).toMatchObject({ panY: -740 });
  fireEvent.wheel(overlay, { deltaX: 0, deltaY: -100000, ctrlKey: true, clientX: 100, clientY: 100 });
  expect(JSON.parse(screen.getByTestId("viewport").textContent!).zoom).toBe(8);
  fireEvent.wheel(overlay, { deltaX: 0, deltaY: 100000, ctrlKey: true, clientX: 100, clientY: 100 });
  expect(JSON.parse(screen.getByTestId("viewport").textContent!).zoom).toBe(.05);
});

it("accumulates consecutive native wheel events before React commits", () => {
  render(<Harness />);
  act(() => {
    for (let index = 0; index < 2; index++) screen.getByTestId("overlay").dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 10, deltaY: 0 }));
  });
  expect(JSON.parse(screen.getByTestId("viewport").textContent!)).toMatchObject({ panX: -8, panY: -8 });
});

it("suppresses wheel while secondary pan owns the pointer and blur restores its initial viewport", () => {
  render(<Harness />);
  const overlay = screen.getByTestId("overlay");
  fireEvent.pointerDown(overlay, point(2, 20, 30));
  fireEvent.pointerMove(overlay, point(2, 60, 55));
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -80 });
  act(() => overlay.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(JSON.parse(screen.getByTestId("viewport").textContent!)).toMatchObject({ zoom: 2, panX: 52, panY: 17 });
  act(() => window.dispatchEvent(new Event("blur")));
  expect(JSON.parse(screen.getByTestId("viewport").textContent!)).toMatchObject({ zoom: 2, panX: 12, panY: -8 });
});

it.each(["pointercancel", "blur", "Escape"])("restores overlay pan on %s without accepting a late up", event => {
  render(<Harness />);
  const overlay = screen.getByTestId("overlay");
  fireEvent.pointerDown(overlay, point(2, 20, 30));
  fireEvent.pointerMove(overlay, point(2, 60, 55));
  if (event === "blur") act(() => window.dispatchEvent(new Event("blur")));
  else if (event === "Escape") fireEvent.keyDown(document, { key: "Escape" });
  else fireEvent.pointerCancel(overlay, point(2, 60, 55));
  fireEvent.pointerUp(overlay, point(2, 90, 100));
  expect(JSON.parse(screen.getByTestId("viewport").textContent!)).toMatchObject({ zoom: 2, panX: 12, panY: -8 });
});

it("does not intercept primary Connector edits or menu chrome", () => {
  const changed = vi.fn();
  render(<Harness changed={changed} />);
  fireEvent.pointerDown(screen.getByTestId("overlay"), point(0, 20, 30));
  fireEvent.pointerMove(screen.getByTestId("overlay"), point(0, 60, 55));
  fireEvent.pointerUp(screen.getByTestId("overlay"), point(0, 60, 55));
  fireEvent.pointerDown(screen.getByTestId("menu"), point(2, 20, 30));
  fireEvent.pointerMove(screen.getByTestId("menu"), point(2, 60, 55));
  fireEvent.pointerUp(screen.getByTestId("menu"), point(2, 60, 55));
  expect(changed).not.toHaveBeenCalled();
});
