/**
 * 迭代 14 —— 预览用的**设备预设**。原型画板的尺寸与外观模拟都从这一张表来。
 *
 * ## 为什么设备是「看的方式」，不是设计的属性
 *
 * 切到 iPhone 不会让原型变成「响应式之后的样子」——这套原语**没有断点**，
 * 换设备只是换画板尺寸，内容按 flex 自适应到新宽度，仅此而已。
 * 所以它不写进 `DesignProject`：写进去会让人以为那是设计的一部分，
 * 于是「这稿是给 iPhone 的」和「我现在用 iPhone 尺寸看」这两件事混成一件。
 * 项目的 `template` 仍然决定**默认**用哪个镜头（`defaultPresetFor`）。
 *
 * ## 为什么用真实逻辑分辨率，而不是随手取的画板尺寸
 *
 * 「模拟」的意义就在于比例是真的：393×852 的 iPhone 上放得下的东西，
 * 换成 375×667 的小屏就未必放得下——这正是设计者要看的。用 300×560 这种
 * 拍脑袋的尺寸，看着像手机，但比例不对，得出的结论也不对。
 *
 * ## 单一事实源
 *
 * 尺寸只在这张表里出现一次：画布用 inline style 读它，画板视图的布局算式读它，
 * 切换器的下拉也从它派生。**不许**在 Tailwind 类里再写一份宽高
 * （那是 Codex 复审时点过的第二份数字）。
 */

/** 外壳形态。决定画哪种 chrome，不决定尺寸。 */
export type PrototypeChrome = "phone" | "tablet" | "browser";

export interface PrototypeDevicePreset {
  readonly id: string;
  readonly label: string;
  readonly chrome: PrototypeChrome;
  /** 逻辑分辨率（CSS px），竖向。横向由 `rotate` 交换宽高得到。 */
  readonly w: number;
  readonly h: number;
  /** 机身圆角（CSS px，按逻辑分辨率给）。浏览器壳用小圆角。 */
  readonly radius: number;
  /** 只有 phone 有：灵动岛（true）还是上下额头（false，如 SE/旧机型）。 */
  readonly island?: boolean;
  /** 能不能横过来看。桌面浏览器没有「竖屏」这回事。 */
  readonly rotatable: boolean;
}

/**
 * 预设是**闭集**，顺序即下拉里的顺序：从小到大。
 * 加一款要有人真的会用它做设计决定，不是因为"再多几个看起来更全"。
 */
export const DEVICE_PRESETS: readonly PrototypeDevicePreset[] = [
  { id: "iphone-se", label: "iPhone SE", chrome: "phone", w: 375, h: 667, radius: 40, island: false, rotatable: true },
  { id: "iphone", label: "iPhone 15", chrome: "phone", w: 393, h: 852, radius: 52, island: true, rotatable: true },
  { id: "ipad", label: "iPad", chrome: "tablet", w: 820, h: 1180, radius: 30, rotatable: true },
  { id: "laptop", label: "笔记本", chrome: "browser", w: 1280, h: 800, radius: 10, rotatable: false },
  { id: "desktop", label: "桌面", chrome: "browser", w: 1440, h: 900, radius: 10, rotatable: false },
];

export const DEFAULT_PRESET_ID = "iphone";

export function presetById(id: string): PrototypeDevicePreset {
  return DEVICE_PRESETS.find((p) => p.id === id) ?? DEVICE_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!;
}

/** 项目模板决定**默认**镜头；用户随后可以切到任何一个，不改项目。 */
export function defaultPresetFor(template: "mobile" | "ui" | "wireframe"): PrototypeDevicePreset {
  return presetById(template === "mobile" ? "iphone" : template === "ui" ? "laptop" : "ipad");
}

/** 横过来看：交换宽高。不可旋转的预设原样返回（调用方不必判）。 */
export function rotated(p: PrototypeDevicePreset, landscape: boolean): { readonly w: number; readonly h: number } {
  return landscape && p.rotatable ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

/**
 * 画板按逻辑分辨率渲染，再整体缩放塞进可用空间。
 *
 * ⚠ **只缩不放**（上限 1）：把 393px 的手机放大到占满一块 900px 的面板，
 * 字会跟着变大，看起来"很清楚"——而那恰恰掩盖了「这行字在真机上有多小」，
 * 正是模拟要回答的问题。宁可周围留白。
 *
 * 容器尺寸为 0（首帧、jsdom）时返回 1：还没量到就先按原尺寸画，
 * 量到之后再收缩，不要在这一帧里除以 0 得到 Infinity 或 NaN。
 */
export function fitScale(
  container: { readonly w: number; readonly h: number },
  device: { readonly w: number; readonly h: number },
): number {
  if (container.w <= 0 || container.h <= 0 || device.w <= 0 || device.h <= 0) return 1;
  return Math.min(1, container.w / device.w, container.h / device.h);
}
