/**
 * 侧栏宽度：**判据与边界的单一事实源**。
 *
 * 2026-09-23 人类要求：结果要能在右边打开、并且**可以拖动边界**。此前整个壳里
 * 一处拖拽都没有（`grep -c "onPointerDown\|resize"` 在 shell 与 inspector 下都是 0）——
 * 右栏只有 `w-72`（288px）展开 / `w-10` 折叠两档，全局壳的左右栏更是写死 272 / 316px。
 *
 * 这个文件只放**纯函数与常量**，不放 React：夹在拖拽事件与 localStorage 之间的那些判断
 * （夹取边界、读写持久值、键盘步长）都能逐字单测，不必去 jsdom 里模拟指针。
 */

/** 展开态的默认宽度，与被它取代的 `w-72` 逐字相等——不改默认观感，只是让它可动。 */
export const PANEL_WIDTH_DEFAULT = 288;

/**
 * 各条侧栏的默认宽度。
 *
 * ⚠ 这些数不是我挑的，是**它们各自原先写死的那个值**（`tailwind.config.ts` 的
 * `width: { panel: "272px", "panel-alt": "316px" }`）。让一条栏变得可拖拽时，默认观感
 * 必须逐字不变——否则「加了个拖拽把手」会连带把所有人的布局挪一下，那是另一回事。
 *
 * 不在这里重抄 tailwind 的数值就无法逐字相等，所以由
 * `tests/lib/panel-width-defaults.test.ts` 机械核对两边一致（本仓头号病是同一事实
 * 声明在两处；这里没法消除副本，那就让副本分叉时会红）。
 */
export const PANEL_DEFAULT_WIDTH: Readonly<Record<string, number>> = {
  "chat-inspector": PANEL_WIDTH_DEFAULT,
  "shell-left": 272,
  "shell-right": 316,
};

/** 某条侧栏的默认宽度；没登记过的退回通用默认值。 */
export function defaultPanelWidth(panel: string): number {
  return PANEL_DEFAULT_WIDTH[panel] ?? PANEL_WIDTH_DEFAULT;
}
/**
 * 下限。低于这个宽度五个页签的标签就开始互相挤（288px 下已经很紧），
 * 再窄不如让用户折叠成 40px 图标条——那是另一档形态，不是更窄的同一档。
 */
export const PANEL_WIDTH_MIN = 240;
/** 上限的**绝对**部分；相对部分见 `clampPanelWidth`（不许吃掉整屏）。 */
export const PANEL_WIDTH_MAX = 720;
/** 视口占比上限：对话本身必须留得下，右栏不该超过一半。 */
export const PANEL_WIDTH_MAX_VIEWPORT_RATIO = 0.5;
/** 键盘调节步长（WAI-ARIA window splitter 模式）。按住 Shift 走大步。 */
export const PANEL_WIDTH_KEY_STEP = 16;
export const PANEL_WIDTH_KEY_STEP_LARGE = 64;

/**
 * 夹到合法区间。`viewportWidth` 缺席（SSR、jsdom 无布局）时只用绝对上下限——
 * **不猜一个视口宽度**，那会让服务端渲染与客户端首帧算出不同的宽度。
 */
export function clampPanelWidth(width: number, viewportWidth?: number): number {
  if (!Number.isFinite(width)) return PANEL_WIDTH_DEFAULT;
  const relativeMax = viewportWidth === undefined || !Number.isFinite(viewportWidth)
    ? PANEL_WIDTH_MAX
    : Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, Math.round(viewportWidth * PANEL_WIDTH_MAX_VIEWPORT_RATIO)));
  return Math.round(Math.min(Math.max(width, PANEL_WIDTH_MIN), relativeMax));
}

/** 持久化的 key。每条侧栏一把，互不覆盖（右栏与将来的左栏不是同一个宽度）。 */
export function panelWidthStorageKey(panel: string): string {
  return `shell.panelWidth.${panel}`;
}

/**
 * 读持久值。读不到 / 不是数字 / 越界 ⇒ 返回默认宽度并**不**写回：
 * 一个读不出来的旧值不该被我们悄悄「修正」成新值写进去，那会掩盖是谁写坏的。
 */
export function readPanelWidth(
  panel: string,
  storage: Pick<Storage, "getItem"> | null,
  viewportWidth?: number,
): number {
  const fallback = defaultPanelWidth(panel);
  if (storage === null) return fallback;
  let raw: string | null;
  try { raw = storage.getItem(panelWidthStorageKey(panel)); } catch { return fallback; }
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? clampPanelWidth(parsed, viewportWidth) : fallback;
}

/** 写持久值。隐私模式 / 配额满时 `setItem` 会抛——宽度不是必须持久的东西，吞掉。 */
export function writePanelWidth(panel: string, width: number, storage: Pick<Storage, "setItem"> | null): void {
  if (storage === null) return;
  try { storage.setItem(panelWidthStorageKey(panel), String(Math.round(width))); } catch { /* 见上 */ }
}

/**
 * 拖拽把「指针位置」换算成「宽度」。右栏的把手在**左**边界上，所以指针往左走宽度变大：
 * `width = 起始宽度 + (起始 x − 当前 x)`。方向写进函数而不是散在事件处理里，
 * 免得将来给左栏复用时把符号搞反（左栏的把手在右边界，方向相反）。
 */
export function widthFromDrag(
  edge: "left" | "right",
  startWidth: number,
  startClientX: number,
  clientX: number,
  viewportWidth?: number,
): number {
  const delta = edge === "left" ? startClientX - clientX : clientX - startClientX;
  return clampPanelWidth(startWidth + delta, viewportWidth);
}

/** 键盘调节：把按键换算成新宽度。认不出的按键返回 `null`（调用方据此不拦默认行为）。 */
export function widthFromKey(
  edge: "left" | "right",
  current: number,
  key: string,
  shiftKey: boolean,
  viewportWidth?: number,
): number | null {
  const step = shiftKey ? PANEL_WIDTH_KEY_STEP_LARGE : PANEL_WIDTH_KEY_STEP;
  // 「变宽」的方向与拖拽一致：右栏往左是变宽。
  const grow = edge === "left" ? "ArrowLeft" : "ArrowRight";
  const shrink = edge === "left" ? "ArrowRight" : "ArrowLeft";
  if (key === grow) return clampPanelWidth(current + step, viewportWidth);
  if (key === shrink) return clampPanelWidth(current - step, viewportWidth);
  if (key === "Home") return clampPanelWidth(PANEL_WIDTH_MAX, viewportWidth);
  if (key === "End") return PANEL_WIDTH_MIN;
  if (key === "Enter" || key === " ") return PANEL_WIDTH_DEFAULT; // 回到默认宽度
  return null;
}
