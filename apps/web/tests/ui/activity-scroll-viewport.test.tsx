// @vitest-environment jsdom
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ActivityScrollViewport } from "../../components/admin/activity-scroll-viewport";
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("sizes the viewport to five complete rows and recalculates wrapping", () => {
 let resize = () => {}; let height = 40;
 vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { resize = cb; } observe() {} disconnect() {} });
 vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
  const row = this as HTMLElement;
  return { top: 10, bottom: 10 + 30 + Number(row.dataset.index ?? 0) * height } as DOMRect;
 });
 const view = render(<ActivityScrollViewport label="Recent activity"><table><tbody>{Array.from({length: 8}, (_, i) => <tr key={i} data-index={i+1}><td>{i}</td></tr>)}</tbody></table></ActivityScrollViewport>);
 const region = view.getByRole("region");
 expect(region.style.maxHeight).toBe("230px");
 expect(view.getAllByRole("row")).toHaveLength(8);
 height = 60; resize(); expect(region.style.maxHeight).toBe("330px");
 view.rerender(<ActivityScrollViewport label="Recent activity"><table><tbody><tr><td>one</td></tr></tbody></table></ActivityScrollViewport>);
 expect(region.style.maxHeight).toBe("");
});
