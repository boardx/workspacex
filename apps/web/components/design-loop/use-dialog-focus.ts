"use client";
import * as React from "react";

/**
 * UC-17.8 B6.5 —— 研发闭环各 drawer / 浮层的**焦点管理**（无障碍复核补的三件事）：
 *
 *   ① 打开时焦点进面板：优先第一个可聚焦元素（关闭按钮通常就是它），没有就落在面板本身
 *      （面板要带 `tabIndex={-1}` 才接得住）。
 *   ② `Esc` 关闭——监听在 `document` 上而不是面板上：焦点若被用户点回遮罩/正文，Esc 仍然要
 *      关得掉，这是 `role="dialog"` + `aria-modal` 的用户预期。
 *   ③ 关闭（卸载）后焦点回到**打开它的那个元素**：打开时记下 `document.activeElement`
 *      （看板卡片 / 草稿卡片 / 「新建设计」按钮），卸载时还回去。触发元素若已不在文档里
 *      （比如那条卡片刚被挪到别的列重渲染），不强行聚焦一个游离节点——让浏览器落回 body，
 *      总比抛异常好。
 *
 * 不做焦点**陷阱**（Tab 循环）：面板是 `fixed` 贴边/居中叠层，遮罩挡住了鼠标，键盘 Tab 走到
 * 页面其它元素只是「多按几下」，不是功能缺陷；而手写 Tab 循环最容易把 Radix/原生 select 的
 * 弹出层困住。`overlay-primitives` 的 Radix Dialog 自带陷阱，这几屏没用它是历史原因（B1/B3.4
 * 用裸 `<aside role="dialog">`），本轮不换组件——换了截图全要重拍，超出 B6.5 范围。
 */
export function useDialogFocus(panelRef: React.RefObject<HTMLElement | null>, onClose: () => void): void {
  // `onClose` 每次渲染都是新函数；用 ref 承接，避免 Esc 监听随之反复挂/卸。
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (panel !== null) {
      const first = panel.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (first ?? panel).focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener !== null && opener.isConnected) opener.focus();
    };
    // 只在挂载/卸载各跑一次：面板的身份就是「这一次打开」。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
