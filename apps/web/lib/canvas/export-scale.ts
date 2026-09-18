/**
 * 画布导出的分辨率上限（`CanvasStage.exportPNG()` 与导出测试共用的**唯一**一处）。
 *
 * 为什么要有上限（2026-09-18 真实事故）：一张八大朝代的 mindmap，逻辑尺寸就有几千
 * 像素高，按固定 `multiplier: 2` 截图得到两三千万像素——PNG 已经很大，进 PDF 后
 * 更是几十 MB（PDF 那一半的根因见 `export-image.ts`）。另外 Safari 的 canvas 最大
 * 面积是 16,777,216 px（4096×4096），超过它 `toDataURL` 直接返回空图，导出会
 * 悄悄变成一张白纸。
 *
 * 策略：**先要清晰度，再要上限**——默认还是 2 倍（文字在 retina 上不糊），只有当
 * `逻辑面积 × multiplier²` 会超过上限时才把 multiplier 往下压到刚好落在上限内；
 * 绝不低于 1（低于 1 倍等于把内容缩小，画面文字会糊，宁可让文件大一点）。
 * 这是纯函数，不碰 fabric，方便单测各种边界。
 */

/** 与 Safari 的 canvas 最大面积一致（4096×4096）。 */
export const EXPORT_MAX_PIXELS = 16_777_216;

/** 默认 2 倍：retina 屏上文字仍然锐利；是"想要"的值，不是"一定给"的值。 */
export const EXPORT_DEFAULT_MULTIPLIER = 2;

export function resolveExportMultiplier(
  logicalWidth: number,
  logicalHeight: number,
  requested: number = EXPORT_DEFAULT_MULTIPLIER,
  maxPixels: number = EXPORT_MAX_PIXELS,
): number {
  const area = Math.max(0, logicalWidth) * Math.max(0, logicalHeight);
  const wanted = Number.isFinite(requested) && requested > 0 ? requested : EXPORT_DEFAULT_MULTIPLIER;
  if (area === 0) return wanted;
  const fits = Math.sqrt(maxPixels / area);
  // 压到刚好落在上限内，但不低于 1；保留两位小数避免浮点误差把面积推到上限外。
  const capped = Math.floor(Math.min(wanted, fits) * 100) / 100;
  return Math.max(1, capped);
}
