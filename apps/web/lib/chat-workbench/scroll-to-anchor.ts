/**
 * 「跳到那条消息 / 那张卡片」—— 滚动定位的**唯一一份**实现。
 *
 * ## 为什么抽出来（2026-09-23）
 *
 * `subtask-run-panel.tsx` 里已经有一份逐字相同的写法（`focusRun`），包括那条最容易
 * 漏掉的特性检测：**jsdom 没有实现 `scrollIntoView`**，直接调会在组件测试里抛未捕获
 * 异常——为了一个纯 UX 细节把测试搞红。产物详情要「跳到原消息」时，第二份副本就会
 * 出现；本仓已经因为「同一事实声明在两处」栽过十一次，这次在出现第二份之前先收敛。
 *
 * ⚠ `CSS.escape` 不是可选项：`data-message-id` 是服务端 id，直接拼进选择器时
 * 一个引号或反斜杠就能让整条选择器语法错误（抛异常，不是静默失配）。
 */

/**
 * 按 `[attribute="value"]` 找到元素并滚进视野。
 *
 * @returns 是否真的找到了那个元素。调用方据此决定要不要提示「原消息已不在当前视图里」——
 *   静默失败会让用户以为按钮坏了。
 */
export function scrollToAnchor(
  attribute: string,
  value: string,
  options: ScrollIntoViewOptions = { block: "nearest", behavior: "smooth" },
): boolean {
  let element: Element | null;
  try {
    element = document.querySelector(`[${attribute}="${CSS.escape(value)}"]`);
  } catch {
    return false;
  }
  if (element === null) return false;
  // jsdom（组件测试环境）没有 `scrollIntoView`。做特性检测而不是假设它总存在。
  if ("scrollIntoView" in element && typeof element.scrollIntoView === "function") {
    element.scrollIntoView(options);
  }
  return true;
}
