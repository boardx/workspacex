import { cloneResearchExportDocument, preparePrintImages } from "./research-report-export";

/** Physical paper sizes are shared by the visible pages and the print stylesheet. */
export const RESEARCH_PRINT_PAPERS = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  A1: { width: 594, height: 841 },
} as const;
export type ResearchPrintPaper = keyof typeof RESEARCH_PRINT_PAPERS;
export type ResearchPrintPreviewResult = "cancelled" | "print-requested";
export type ResearchPrintPreviewOptions = {
  isCurrent?: () => boolean;
  defaultPaper?: ResearchPrintPaper;
  /** A real native canvas is fitted as a whole, without changing its aspect ratio. */
  layout?: "flow" | "canvas";
  canvasSize?: { width: number; height: number };
  /** Native Design exporter output; sanitized again, never a URL or a fetch instruction. */
  nativeDocuments?: readonly string[];
};
const PX_PER_MM = 96 / 25.4;
const MARGIN_MM = 16;

function safeImageUrl(value: string): boolean {
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(value)) return true;
  try {
    const url = new URL(value, window.location.href);
    return (url.protocol === "blob:" && url.origin === window.location.origin)
      || (url.origin === window.location.origin && /^https?:$/.test(url.protocol));
  } catch { return false; }
}

/** Work on a detached clone. No active content, controls or new remote images. */
function previewSnapshot(root: HTMLElement): HTMLElement {
  const clone = cloneResearchExportDocument(root);
  const originals = [...root.querySelectorAll("canvas")].filter(canvas => !canvas.closest('[data-report-ui], [data-testid="research-report-references"]'));
  clone.querySelectorAll("canvas").forEach((canvas, index) => {
    const original = originals[index];
    if (!original || !original.width || !original.height) throw new Error("打印画布不可读取");
    const image = document.createElement("img");
    image.src = original.toDataURL("image/png");
    image.width = original.width; image.height = original.height;
    image.alt = original.getAttribute("aria-label") ?? "原生画布";
    canvas.replaceWith(image);
  });
  clone.querySelectorAll("script,style,link,meta,base,iframe,object,embed,form,input,textarea,select,button,audio,video").forEach(node => node.remove());
  for (const node of [clone, ...clone.querySelectorAll("*")]) {
    for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name) || ["srcdoc", "srcset", "formaction", "contenteditable", "autofocus"].includes(attribute.name)) node.removeAttribute(attribute.name);
      const urls = [...attribute.value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)];
      if (urls.some(match => !match[2]?.startsWith("#")) || (attribute.name === "style" && /expression\s*\(|@import/i.test(attribute.value))) node.removeAttribute(attribute.name);
    }
    if (node.tagName.toLowerCase() === "a") {
      const href = node.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href) && !href.startsWith("#")) node.removeAttribute("href");
      node.removeAttribute("target");
    }
    if (node.namespaceURI === "http://www.w3.org/2000/svg" && !["image", "a"].includes(node.tagName.toLowerCase())) {
      for (const attribute of ["href", "xlink:href"]) if (node.hasAttribute(attribute) && !node.getAttribute(attribute)?.startsWith("#")) node.removeAttribute(attribute);
    }
    if (node instanceof HTMLImageElement) {
      if (!safeImageUrl(node.src)) throw new Error("打印图片来源不可读取，请回到原材料核对");
      node.loading = "eager";
    }
    if (node.tagName.toLowerCase() === "image") {
      const href = node.getAttribute("href") ?? node.getAttribute("xlink:href") ?? "";
      if (!safeImageUrl(href)) throw new Error("打印画布图片来源不可读取");
    }
    if (node instanceof HTMLElement && node.style.breakBefore === "page") node.style.breakBefore = "column";
    if (node instanceof HTMLDetailsElement) node.open = true;
  }
  return clone;
}

/** Template parsing keeps even image/iframe resources inert until the native snapshot is checked. */
export function parseResearchPrintHtml(html: string): Document {
  if (html.length > 8_000_000) throw new Error("原型打印内容超出安全预览范围");
  const template = document.createElement("template"); template.innerHTML = html;
  const parsed = document.implementation.createHTMLDocument("");
  parsed.head.replaceChildren(); parsed.body.replaceChildren();
  for (const node of [...template.content.childNodes]) {
    if (node instanceof Element && ["STYLE", "META", "TITLE", "LINK", "BASE"].includes(node.tagName)) parsed.head.append(node);
    else parsed.body.append(node);
  }
  parsed.documentElement.className = html.match(/<html[^>]*class="([^"]*)"/i)?.[1] ?? "";
  return parsed;
}

function nativeSnapshot(html: string, images: HTMLImageElement[], depth = 0): string {
  if (depth > 3 || html.length > 8_000_000) throw new Error("原型打印内容超出安全预览范围");
  const parsed = parseResearchPrintHtml(html);
  parsed.querySelectorAll('script,link,base,meta[http-equiv="refresh"]').forEach(node => node.remove());
  for (const node of [...parsed.querySelectorAll("*")]) {
    for (const attribute of [...node.attributes]) if (/^on/i.test(attribute.name) || ["action", "formaction", "srcset", "target", "autofocus"].includes(attribute.name)) node.removeAttribute(attribute.name);
    if (node instanceof HTMLIFrameElement) {
      const content = node.getAttribute("srcdoc");
      if (!content || node.hasAttribute("src")) throw new Error("原型打印不读取外链页面");
      node.srcdoc = nativeSnapshot(content, images, depth + 1);
      // Native HTML-page frames remain opaque and cannot navigate or submit forms.
      node.setAttribute("sandbox", "allow-scripts");
      node.tabIndex = -1;
    }
    if (node instanceof HTMLImageElement) {
      const source = node.getAttribute("src") ?? "";
      if (!safeImageUrl(source)) throw new Error("原型图片来源不可读取");
      const image = document.createElement("img"); image.src = source; images.push(image);
      node.src = image.src; node.loading = "eager";
    }
  }
  const policy = parsed.createElement("meta"); policy.httpEquiv = "Content-Security-Policy";
  policy.content = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; frame-src about:; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'";
  parsed.head.prepend(policy);
  return "<!doctype html>" + parsed.documentElement.outerHTML;
}

/** Opens a read-only preview. Only its explicit Print button can invoke window.print. */
export async function openResearchPrintPreview(root: HTMLElement, title: string, options: ResearchPrintPreviewOptions = {}): Promise<ResearchPrintPreviewResult> {
  if (options.isCurrent?.() === false) throw new Error("打印内容或访问状态已变化");
  const snapshot = previewSnapshot(root);
  const nativeImages: HTMLImageElement[] = [];
  if (options.nativeDocuments && (!options.nativeDocuments.length || options.nativeDocuments.length > 100)) throw new Error("尚无可预览的实际原型页面");
  const nativeDocuments = options.nativeDocuments?.map(html => nativeSnapshot(html, nativeImages));
  const dimensions = options.canvasSize ?? root.getBoundingClientRect();
  if (options.layout === "canvas" && (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0)) throw new Error("原生模板尺寸不可读取");
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement("dialog");
  dialog.dataset.testid = "research-print-preview";
  dialog.setAttribute("aria-label", "打印预览");
  dialog.style.cssText = "width:min(1200px,calc(100vw - 24px));height:calc(100dvh - 24px);max-width:none;max-height:none;padding:0;border:1px solid #d8d8dc;border-radius:16px;background:#f3f3f5;color:#18181b;overflow:hidden;box-shadow:0 24px 80px #0003";
  const toolbar = document.createElement("div");
  toolbar.style.cssText = "display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:14px 18px;border-bottom:1px solid #ddd;background:#fff;font:14px/1.5 system-ui,sans-serif";
  const heading = document.createElement("h2"); heading.textContent = title; heading.style.cssText = "flex:1;min-width:120px;margin:0;font-size:16px;overflow-wrap:anywhere";
  const label = document.createElement("label"); label.textContent = "纸张 ";
  const paper = document.createElement("select"); paper.setAttribute("aria-label", "打印纸张"); paper.dataset.testid = "research-print-paper";
  for (const name of Object.keys(RESEARCH_PRINT_PAPERS) as ResearchPrintPaper[]) {
    const option = document.createElement("option"); option.value = name; option.textContent = name; paper.append(option);
  }
  paper.value = options.defaultPaper ?? "A4"; label.append(paper);
  const zoomLabel = document.createElement("label"); zoomLabel.textContent = "缩放 ";
  const zoom = document.createElement("select"); zoom.setAttribute("aria-label", "预览缩放");
  for (const [value, text] of [["fit", "适合宽度"], ["actual", "100%"]]) {
    const option = document.createElement("option"); option.value = value!; option.textContent = text!; zoom.append(option);
  }
  zoomLabel.append(zoom);
  const pageCount = document.createElement("span"); pageCount.dataset.testid = "research-print-page-count";
  const print = document.createElement("button"); print.type = "button"; print.textContent = "打印 / 另存为 PDF"; print.disabled = true; print.dataset.testid = "research-print-confirm";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "关闭预览"; cancel.dataset.testid = "research-print-cancel";
  for (const control of [paper, zoom, print, cancel]) control.style.cssText = "font:inherit;border:1px solid #d1d1d6;border-radius:8px;padding:7px 12px;background:#fff;color:inherit;cursor:pointer";
  print.style.cssText += ";background:#18181b;color:#fff;border-color:#18181b";
  toolbar.append(heading, label, zoomLabel, pageCount, print, cancel);
  const status = document.createElement("p"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  status.style.cssText = "font:12px/1.5 system-ui,sans-serif;margin:0;padding:8px 18px;background:#fff";
  status.textContent = "正在准备分页预览…";
  const frame = document.createElement("iframe"); frame.title = title + " · 分页预览"; frame.dataset.testid = "research-print-pages";
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.style.cssText = "display:block;border:0;flex:1;min-height:0;width:100%;background:#eaeaee";
  const shell = document.createElement("div"); shell.style.cssText = "display:flex;flex-direction:column;height:100%"; shell.append(toolbar, status, frame); dialog.append(shell);
  document.body.append(dialog);
  if (typeof dialog.showModal !== "function") { dialog.remove(); throw new Error("当前浏览器不支持打印预览"); }

  return new Promise<ResearchPrintPreviewResult>((resolve, reject) => {
    let ended = false, generation = 0, printing = false, requested = false, ready = false;
    const finish = (result: ResearchPrintPreviewResult, error?: unknown) => {
      if (ended) return;
      ended = true; window.clearInterval(watch); window.removeEventListener("resize", fitPages);
      dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
      if (error) reject(error); else resolve(result);
    };
    const current = () => !ended && dialog.isConnected && options.isCurrent?.() !== false;
    const fitPages = () => {
      const target = frame.contentDocument;
      if (!target) return;
      const width = RESEARCH_PRINT_PAPERS[paper.value as ResearchPrintPaper].width * PX_PER_MM;
      const scale = zoom.value === "actual" ? 1 : Math.min(1, Math.max(0.1, (frame.clientWidth - 40) / width));
      target.documentElement.style.setProperty("--preview-scale", String(scale));
    };
    const watch = window.setInterval(() => {
      if (!current()) finish("cancelled", new Error("打印内容或访问状态已变化，请重新打开预览"));
    }, 250);
    cancel.onclick = () => finish(requested ? "print-requested" : "cancelled");
    dialog.addEventListener("cancel", event => { event.preventDefault(); if (!printing) finish(requested ? "print-requested" : "cancelled"); });
    dialog.addEventListener("close", () => finish(requested ? "print-requested" : "cancelled"));
    window.addEventListener("resize", fitPages);

    async function paginate() {
      const attempt = ++generation;
      ready = false; print.disabled = true; status.textContent = "正在核对图片和分页…";
      try {
        if (!current()) throw new Error("打印内容或访问状态已变化");
        const target = frame.contentDocument, view = frame.contentWindow;
        if (!target || !view) throw new Error("无法打开分页预览");
        const size = RESEARCH_PRINT_PAPERS[paper.value as ResearchPrintPaper];
        const width = size.width * PX_PER_MM, height = size.height * PX_PER_MM;
        const margin = MARGIN_MM * PX_PER_MM, bodyWidth = width - margin * 2, bodyHeight = height - margin * 2;
        target.body.replaceChildren(); target.head.replaceChildren(); target.title = title;
        const style = target.createElement("style");
        style.textContent = `@page{size:${size.width}mm ${size.height}mm;margin:0}*{box-sizing:border-box}html{--preview-scale:1}body{margin:0;background:#eaeaee;color:#111;font:11pt/1.8 system-ui,sans-serif}h1,h2,h3,h4,h5{break-after:avoid;overflow-wrap:anywhere}h2{font-size:22pt}h3{font-size:16pt}h4{font-size:13pt}p{orphans:3;widows:3;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}a{color:inherit;overflow-wrap:anywhere}img,svg{max-width:100%;max-height:${bodyHeight}px;object-fit:contain}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{border:1px solid #ccc;padding:6pt;overflow-wrap:anywhere}tr{break-inside:avoid}li{margin-bottom:6pt}section{margin-top:18pt}.paper-wrap{width:calc(${width}px * var(--preview-scale));height:calc(${height}px * var(--preview-scale));margin:24px auto}.paper{position:relative;width:${width}px;height:${height}px;background:#fff;box-shadow:0 2px 16px #0002;transform:scale(var(--preview-scale));transform-origin:top left;overflow:hidden}.viewport{position:absolute;left:${margin}px;top:${margin}px;width:${bodyWidth}px;height:${bodyHeight}px;overflow:hidden}.flow{width:${bodyWidth}px;height:${bodyHeight}px;column-width:${bodyWidth}px;column-gap:0;column-fill:auto;position:relative}.page-number{position:absolute;bottom:5mm;left:0;width:100%;text-align:center;font-size:9pt;color:#666}.accessible{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@media print{html{--preview-scale:1}body{background:#fff}.paper-wrap{width:${width}px;height:${height}px;margin:0;break-after:page}.paper-wrap[data-last-page=true]{break-after:auto}.paper{box-shadow:none;transform:none}.accessible{display:none}}`;
        target.head.append(style);
        if (nativeDocuments) {
          await preparePrintImages(nativeImages);
          if (!current() || attempt !== generation) return;
          for (const [index, html] of nativeDocuments.entries()) {
            const wrap = target.createElement("section"); wrap.className = "paper-wrap";
            if (index === nativeDocuments.length - 1) wrap.dataset.lastPage = "true";
            const page = target.createElement("div"); page.className = "paper"; page.dataset.page = String(index + 1);
            const viewport = target.createElement("div"); viewport.className = "viewport";
            const native = target.createElement("iframe"); native.title = `${title} · 实际第 ${index + 1} 页`;
            native.setAttribute("sandbox", "allow-same-origin");
            native.tabIndex = -1;
            native.style.cssText = "display:block;width:1400px;height:1000px;border:0;transform-origin:top left;pointer-events:none";
            const loaded = new Promise<void>((done, failed) => {
              const timer = window.setTimeout(() => failed(new Error("实际原型页面读取超时")), 10_000);
              native.onload = () => { window.clearTimeout(timer); done(); };
              native.onerror = () => { window.clearTimeout(timer); failed(new Error("实际原型页面不可读取")); };
            });
            native.srcdoc = html; viewport.append(native); page.append(viewport); wrap.append(page); target.body.append(wrap);
            await loaded;
            const doc = native.contentDocument;
            if (!doc) throw new Error("实际原型页面不可读取");
            await preparePrintImages([...doc.querySelectorAll("img")]);
            await doc.fonts.ready;
            if (!current() || attempt !== generation) return;
            const nativeWidth = Math.max(1400, doc.documentElement.scrollWidth, doc.body.scrollWidth);
            native.style.width = `${nativeWidth}px`;
            const nativeHeight = Math.max(1, doc.documentElement.scrollHeight, doc.body.scrollHeight);
            native.style.height = `${nativeHeight}px`;
            native.style.transform = `scale(${Math.min(bodyWidth / nativeWidth, bodyHeight / nativeHeight)})`;
            const number = target.createElement("div"); number.className = "page-number"; number.textContent = `${index + 1} / ${nativeDocuments.length}`; page.append(number);
          }
          fitPages(); pageCount.textContent = `${nativeDocuments.length} 页`; ready = true; print.disabled = false;
          status.textContent = "已读取原型页面清单，未生成页面仍保留缺口。请核对内容再请求系统打印；关闭不会保存或确认原型。";
          return;
        }
        const flow = target.createElement("div"); flow.className = "flow"; flow.style.cssText = "position:absolute;left:0;top:0;opacity:0;pointer-events:none";
        const content = target.importNode(snapshot, true);
        if (options.layout === "canvas") {
          flow.style.columnWidth = "auto";
          const scale = Math.min(bodyWidth / dimensions.width, bodyHeight / dimensions.height);
          content.style.cssText += `;width:${dimensions.width}px;height:${dimensions.height}px;transform:scale(${scale});transform-origin:top left`;
        }
        flow.append(content); target.body.append(flow);
        await preparePrintImages([...content.querySelectorAll("img")]);
        await target.fonts?.ready;
        if (!current() || attempt !== generation) return;
        // Layout uses CSS columns; each visible/printed page shows the same exact column.
        const count = options.layout === "canvas" ? 1 : Math.max(1, Math.ceil((flow.scrollWidth - 1) / bodyWidth));
        if (count > 100 || (options.layout !== "canvas" && flow.scrollHeight > bodyHeight + 2)) throw new Error("内容超出当前分页范围，请核对原件或调整纸张后重试");
        for (let index = 0; index < count; index++) {
          const wrap = target.createElement("section"); wrap.className = "paper-wrap";
          if (index === count - 1) wrap.dataset.lastPage = "true";
          const page = target.createElement("div"); page.className = "paper"; page.dataset.page = String(index + 1); page.setAttribute("aria-label", `第 ${index + 1} 页`);
          const viewport = target.createElement("div"); viewport.className = "viewport";
          const visible = flow.cloneNode(true) as HTMLDivElement; visible.style.cssText = flow.style.cssText;
          visible.style.position = "relative"; visible.style.left = `${-index * bodyWidth}px`; visible.style.opacity = "1"; visible.style.pointerEvents = "auto"; visible.setAttribute("aria-hidden", "true");
          const number = target.createElement("div"); number.className = "page-number"; number.textContent = `${index + 1} / ${count}`;
          viewport.append(visible); page.append(viewport, number); wrap.append(page); target.body.append(wrap);
        }
        const accessible = target.importNode(snapshot, true); accessible.classList.add("accessible"); accessible.setAttribute("aria-label", "打印正文"); target.body.append(accessible); flow.remove();
        target.onclick = event => { if ((event.target as Element | null)?.closest?.("a")) event.preventDefault(); };
        await preparePrintImages([...target.querySelectorAll("img")]);
        if (!current() || attempt !== generation) return;
        fitPages(); pageCount.textContent = `${count} 页`; ready = true; print.disabled = false;
        status.textContent = "请核对分页。打印机和纸张设置请在系统打印窗口确认；关闭预览不会保存或修改成果。";
      } catch (error) {
        if (attempt !== generation || ended) return;
        status.textContent = error instanceof Error ? error.message : "预览暂不可用，请核对图片后重试";
        pageCount.textContent = ""; print.disabled = true;
      }
    }
    paper.onchange = () => { if (!printing) void paginate(); };
    zoom.onchange = fitPages;
    print.onclick = () => {
      if (!ready || printing || !current()) return;
      const view = frame.contentWindow;
      if (!view) return;
      printing = true; paper.disabled = true; print.disabled = true; cancel.disabled = true;
      try {
        view.addEventListener("afterprint", () => finish("print-requested"), { once: true });
        view.focus();
        // This is the only print invocation. Opening/changing/closing preview never prints.
        requested = true;
        view.print();
        if (!ended) {
          printing = false; cancel.disabled = false;
          status.textContent = "已请求系统打印窗口。是否另存成功请核对实际文件；也可以关闭预览。";
        }
      } catch {
        requested = false; printing = false; paper.disabled = false; print.disabled = false; cancel.disabled = false;
        status.textContent = "未能打开系统打印窗口，请重试；成果未改变。";
      }
    };
    try { dialog.showModal(); void paginate(); }
    catch (error) { finish("cancelled", error); }
  });
}
