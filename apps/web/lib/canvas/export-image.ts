/**
 * 画布导出（人类要求："要可以下载，画布在前端要有 pdf，png 的导出"）。
 *
 * 只做两件事：① 把 `CanvasStage.exportPNG()` 产出的 data URL 触发成浏览器下载；
 * ② 把同一份 data URL 嵌进一页 PDF 再触发下载。PNG 截图本身（内容包围盒计算、
 * viewport 复位）是 `CanvasStage` 自己的职责（它握着真实 fabric 实例），这个文件
 * 不重新实现那一半，只接手"data URL → 文件下载"这一段——两种格式复用同一次
 * 截图，不是"点 PDF 按钮又重新截一次图"。
 *
 * `jspdf` 用**动态 import**：只有用户真的点了「导出 PDF」才加载这个库，不让
 * `CanvasStage` 的每一个使用方（气泡只读预览、mindmap 编辑器……）都背上这份
 * 体积，即便他们从来不会点这个按钮。
 */

/** data URL → 触发浏览器下载。`<a download>` 是标准做法，这里不是给沙盒环境用的
 *  那种下载（本文件跑在真实产品的浏览器里，不是 Artifact 沙盒）。 */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * 把一张 PNG data URL 嵌进一页 PDF（页面尺寸＝画布**逻辑**尺寸转 pt，不额外加白边/
 * 缩放变形），触发下载。`widthPx`/`heightPx` 是 `exportPNG()` 返回的逻辑尺寸；截图
 * 本身的像素是它的 `multiplier` 倍，铺到同一页面上就是更高的 DPI，不会拉伸变形。
 *
 * ⚠ `compression: "FAST"` 不是可选的优化（2026-09-18 真实事故）：jsPDF 的 `addImage`
 * 默认 `compression = "NONE"`——它会把 PNG **解码成裸位图**原样写进 PDF，每像素 3～4
 * 字节，一张 4000×6000 的 mindmap 就是 72 MB（node 里实测；同图 FAST 是 0.49 MB，
 * 与 PNG 本身相当）。FAST 是无损 Flate，清晰度分毫不减；MEDIUM/SLOW 只多耗 CPU、
 * 体积几乎不变，所以取 FAST。
 */
export const PDF_IMAGE_COMPRESSION = "FAST" as const;

/**
 * PDF 的长度单位 pt 是 1/72 英寸，CSS 像素是 1/96 英寸，所以 1px = 72/96 = 0.75pt。
 * 这是单位制本身的事实，不是本仓挑的系数——导出的 PDF 页面尺寸按它从逻辑像素换算。
 *
 * 导出它是为了让「读回 PDF 核页面尺寸」的测试能**把这个常量本身钉在 72/96 上**
 * （见 `tests/ui/canvas-export-artifact-readback.test.tsx`）：测试自己按单位制独立
 * 算期望值，再核对实现用的系数与之相等——而不是在测试里跟着抄一遍 0.75。
 */
export const PX_TO_PT = 0.75;

export async function exportPngAsPdf(
  pngDataUrl: string,
  widthPx: number,
  heightPx: number,
  filename: string,
): Promise<void> {
  const doc = await buildPdfFromPng(pngDataUrl, widthPx, heightPx);
  doc.save(filename);
}

/** 只组装、不下载——让测试能对产出的 PDF 字节断言（体积、Flate 过滤器），而不用
 *  mock 掉 `save`。 */
export async function buildPdfFromPng(pngDataUrl: string, widthPx: number, heightPx: number) {
  const { jsPDF } = await import("jspdf");
  // 页面尺寸按图片逻辑尺寸换算（系数见 `PX_TO_PT`），图片再原样铺满整页，
  // 不留白边也不裁切。
  const pageWidth = widthPx * PX_TO_PT;
  const pageHeight = heightPx * PX_TO_PT;
  const doc = new jsPDF({
    orientation: pageWidth >= pageHeight ? "landscape" : "portrait",
    unit: "pt",
    format: [pageWidth, pageHeight],
  });
  doc.addImage({
    imageData: pngDataUrl,
    format: "PNG",
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
    compression: PDF_IMAGE_COMPRESSION,
  });
  return doc;
}
