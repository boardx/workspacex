import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { printResearchPdf } from "@/lib/research-report-export";

type PrintFrame = { frame: HTMLIFrameElement; print: ReturnType<typeof vi.fn>; view: Window };
let frames: PrintFrame[], decoded: HTMLImageElement[], decode: (image: HTMLImageElement) => Promise<void>;
function loaded(image: HTMLImageElement) { Object.defineProperties(image, { naturalWidth: { configurable: true, value: 20 }, naturalHeight: { configurable: true, value: 10 } }); }
function report(count = 1) {
  const article = document.createElement("article"), title = document.createElement("h2"); title.textContent = "教学报告"; article.append(title);
  const text = document.createElement("p"); text.textContent = "原话 <script> 保持文本"; article.append(text);
  for (let n = 0; n < count; n++) { const image = document.createElement("img"); image.src = `blob:source-${n}`; image.loading = "lazy"; article.append(image); }
  return article;
}
beforeEach(() => {
  frames = []; decoded = []; decode = async image => { loaded(image); };
  const append = document.body.append;
  vi.spyOn(document.body, "append").mockImplementation(function (this: HTMLElement, ...nodes: (Node | string)[]) {
    append.apply(this, nodes);
    for (const node of nodes) if (node instanceof HTMLIFrameElement) {
      const view = node.contentWindow!; const print = vi.fn();
      Object.defineProperty(view, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => { callback(0); return 1; } });
      Object.defineProperty(view, "focus", { configurable: true, value: vi.fn() }); Object.defineProperty(view, "print", { configurable: true, value: print });
      Object.defineProperty(Object.getPrototypeOf(view.document.createElement("img")), "decode", { configurable: true, value: function (this: HTMLImageElement) { decoded.push(this); return decode(this); } });
      frames.push({ frame: node, print, view });
    }
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

it("waits for the actual imported image in the isolated frame, then cleans up after printing", async () => {
  let finish!: () => void; decode = image => new Promise<void>(resolve => { finish = () => { loaded(image); resolve(); }; });
  const source = report(); loaded(source.querySelector("img")!);
  const request = printResearchPdf(source, "审阅稿");
  const target = frames[0]!;
  expect(decoded).toHaveLength(1); expect(decoded[0]).not.toBe(source.querySelector("img"));
  expect(decoded[0]?.ownerDocument).toBe(target.frame.contentDocument); expect(decoded[0]?.loading).toBe("eager");
  expect(target.print).not.toHaveBeenCalled(); finish(); await request;
  expect(target.print).toHaveBeenCalledOnce(); expect(target.frame.contentDocument?.title).toBe("审阅稿");
  target.view.dispatchEvent(new Event("afterprint")); expect(target.frame.isConnected).toBe(false);
  expect(source.querySelectorAll("img")).toHaveLength(1);
});
it("requires every cloned image, not only the first, to decode", async () => {
  const finish: (() => void)[] = []; decode = image => new Promise<void>(resolve => { finish.push(() => { loaded(image); resolve(); }); });
  const request = printResearchPdf(report(3)); expect(finish).toHaveLength(3);
  finish[0]!(); finish[1]!(); await Promise.resolve(); await Promise.resolve();
  expect(frames[0]!.print).not.toHaveBeenCalled(); finish[2]!(); await request;
  expect(frames[0]!.print).toHaveBeenCalledOnce();
});
it("does not print a failed clone and allows retry with the unchanged reader document", async () => {
  const source = report(); decode = async () => { throw new Error("bad cloned image"); };
  await expect(printResearchPdf(source)).rejects.toThrow("bad cloned image");
  expect(frames[0]!.print).not.toHaveBeenCalled(); expect(frames[0]!.frame.isConnected).toBe(false);
  expect(source.textContent).toContain("原话 <script> 保持文本"); expect(source.querySelectorAll("img")).toHaveLength(1);
  decode = async image => { loaded(image); }; await printResearchPdf(source);
  expect(frames[1]!.print).toHaveBeenCalledOnce();
});
it("blocks a decoded zero-dimension image and times out a clone which never finishes", async () => {
  decode = async () => undefined;
  await expect(printResearchPdf(report())).rejects.toThrow("Print image unavailable"); expect(frames[0]!.print).not.toHaveBeenCalled();
  vi.useFakeTimers(); decode = () => new Promise(() => undefined);
  const request = expect(printResearchPdf(report())).rejects.toThrow("Print images timed out");
  await vi.advanceTimersByTimeAsync(10_000); await request;
  expect(frames[1]!.print).not.toHaveBeenCalled(); expect(frames[1]!.frame.isConnected).toBe(false);
});
it("rechecks the owning scope immediately before print after a delayed clone decode", async () => {
  let finish!: () => void; let current = true;
  decode = image => new Promise<void>(resolve => { finish = () => { loaded(image); resolve(); }; });
  const request = printResearchPdf(report(), undefined, { isCurrent: () => current }); current = false; finish();
  await expect(request).rejects.toThrow("Print cancelled"); expect(frames[0]!.print).not.toHaveBeenCalled(); expect(frames[0]!.frame.isConnected).toBe(false);
});
it("still prints an ordinary report without images, retaining text and removing report UI", async () => {
  const source = report(0), ui = document.createElement("button"); ui.dataset.reportUi = "true"; ui.textContent = "编辑工具"; source.append(ui);
  await printResearchPdf(source);
  expect(decoded).toHaveLength(0); expect(frames[0]!.print).toHaveBeenCalledOnce();
  expect(frames[0]!.frame.contentDocument?.body.textContent).toContain("原话 <script> 保持文本");
  expect(frames[0]!.frame.contentDocument?.querySelector("script")).toBeNull();
  expect(frames[0]!.frame.contentDocument?.body.textContent).not.toContain("编辑工具"); expect(source.textContent).toContain("编辑工具");
});
