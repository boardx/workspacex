/** Rasterize HTML pages in a separate, script-disabled document. The live
 * opaque-origin iframe stays unchanged; its srcdoc is the rendering source. */
export async function capturePrototypeFrame(
  frame: HTMLElement,
  capture: (element: HTMLElement, options: { backgroundColor: null; scale: number; useCORS: boolean; logging: boolean }) => Promise<HTMLCanvasElement>,
): Promise<HTMLCanvasElement> {
  const options = { backgroundColor: null, scale: 2, useCORS: true, logging: false } as const;
  const live = frame.querySelector<HTMLIFrameElement>('iframe[data-testid="design-html-page"], iframe[srcdoc]');
  if (!live) return capture(frame, options);
  // Never enable scripts and same-origin together, even in the temporary frame.
  const parsed = new DOMParser().parseFromString(live.srcdoc, "text/html");
  parsed.querySelectorAll("script").forEach((script) => script.remove());
  const csp = parsed.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'; connect-src 'none'; form-action 'none'";
  parsed.head.prepend(csp);
  const isolated = document.createElement("iframe");
  isolated.setAttribute("sandbox", "allow-same-origin");
  isolated.style.cssText = `position:fixed;left:-100000px;top:0;border:0;width:${live.clientWidth || frame.clientWidth || 390}px;height:${live.clientHeight || frame.clientHeight || 844}px`;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("原型截图渲染超时")), 10000);
      isolated.onload = () => { window.clearTimeout(timeout); resolve(); };
      isolated.onerror = () => { window.clearTimeout(timeout); reject(new Error("原型截图渲染失败")); };
      isolated.srcdoc = `<!doctype html>${parsed.documentElement.outerHTML}`;
      document.body.appendChild(isolated);
    });
    const doc = isolated.contentDocument;
    if (!doc?.body) throw new Error("原型截图内容不可读");
    await doc.fonts?.ready;
    await Promise.all(Array.from(doc.images).map((img) => img.decode?.().catch(() => undefined)));
    return await capture(doc.body, options);
  } finally {
    isolated.remove();
  }
}
