import { expect, it, vi } from "vitest";
import { capturePrototypeFrame } from "@/lib/prototype-png-export";

it("captures HTML content in a script-disabled document, without changing the live sandbox", async () => {
  const frame = document.createElement("div");
  const live = document.createElement("iframe");
  live.setAttribute("sandbox", "allow-scripts");
  live.srcdoc = '<html><body><h1>资料列表</h1><table><tr><td>访谈记录</td></tr></table><script>bad()</script></body></html>';
  frame.append(live);
  document.body.append(frame);
  const append = document.body.appendChild.bind(document.body);
  const spy = vi.spyOn(document.body, "appendChild").mockImplementation((node) => {
    const result = append(node);
    if (node instanceof HTMLIFrameElement) queueMicrotask(() => {
      expect(node.getAttribute("sandbox")).toBe("allow-same-origin");
      expect(node.srcdoc).not.toContain("bad()");
      node.contentDocument!.open();
      node.contentDocument!.write(node.srcdoc);
      node.contentDocument!.close();
      node.dispatchEvent(new Event("load"));
    });
    return result;
  });
  const capture = vi.fn(async (target: HTMLElement) => {
    expect(target.textContent).toContain("资料列表");
    expect(target.querySelector("td")?.textContent).toBe("访谈记录");
    return document.createElement("canvas");
  });
  try {
    await capturePrototypeFrame(frame, capture);
    expect(capture).toHaveBeenCalledOnce();
    expect(live.getAttribute("sandbox")).toBe("allow-scripts");
    expect(document.body.querySelectorAll("iframe")).toHaveLength(1);
  } finally { spy.mockRestore(); frame.remove(); }
});
