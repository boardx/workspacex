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
 * 把一张 PNG data URL 嵌进一页 PDF（页面尺寸＝图片像素尺寸转 pt，不额外加白边/
 * 缩放变形），触发下载。`multiplier` 截出来的图分辨率越高，这里页面尺寸换算
 * 用的 `widthPx`/`heightPx` 必须是**截图实际像素尺寸**（`exportPNG()` 已经把
 * `multiplier` 应用过的最终宽高一并返回，不是画布逻辑尺寸），否则图片在 PDF 里
 * 会被拉伸变形。
 */
export async function exportPngAsPdf(
  pngDataUrl: string,
  widthPx: number,
  heightPx: number,
  filename: string,
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  // jsPDF 的 'pt' 单位下 1px = 0.75pt（96 dpi 换算，业界导出工具的通行做法，
  // 不是任意选的系数）——页面尺寸按图片像素尺寸换算，图片再原样铺满整页，
  // 不留白边也不裁切。
  const PX_TO_PT = 0.75;
  const pageWidth = widthPx * PX_TO_PT;
  const pageHeight = heightPx * PX_TO_PT;
  const doc = new jsPDF({
    orientation: pageWidth >= pageHeight ? "landscape" : "portrait",
    unit: "pt",
    format: [pageWidth, pageHeight],
  });
  doc.addImage(pngDataUrl, "PNG", 0, 0, pageWidth, pageHeight);
  doc.save(filename);
}
