/**
 * 2026-08-30（引用文件规模纪律拆分）—— 本文件从 `copilotkit-v2-panel.tsx` 拆出：
 * `isScrolledNearBottom`/`SCROLL_BOTTOM_THRESHOLD_PX` 是纯函数/常量，被
 * `copilotkit-v2-panel.tsx`（公开重导出，供既有测试 import 路径不变）与
 * `copilotkit-v2-panel-body.tsx`（`handleMessagesScroll` 实际调用处）两侧共用；
 * 单独抽成文件避免两侧互相 import 对方造成循环依赖。行为逐字节未变。
 *
 * issue #2071 —— 消息区"贴底"判定的阈值，单一事实源：`handleMessagesScroll`（决定要
 * 不要显示"回到最新"悬浮按钮 + 要不要继续自动跟随新消息）与其测试共用同一个数字，
 * 不是各自维护一份容易漂移的 `80`。比"恰好贴底"（0px）宽松一点，避免子像素/字体
 * 度量误差导致贴底判定抖动（滚动到底后立刻因 1px 误差被判定为"离开了底部"）。
 */
export const SCROLL_BOTTOM_THRESHOLD_PX = 80;

/** 纯函数，供组件与单元测试共用——不依赖真实 DOM 布局，可以直接喂三个数字测。 */
export function isScrolledNearBottom(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight < SCROLL_BOTTOM_THRESHOLD_PX;
}
