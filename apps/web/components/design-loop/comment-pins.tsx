"use client";
/**
 * 对标 R8（#3933）—— 画布上的批注钉。
 *
 * 一层**不参与布局**的覆盖（absolute、不接鼠标），按节点当前在屏上的位置把编号钉在它右上角。
 * 位置是量出来的（`[data-node-id]` 相对画布内容区的偏移），不是把钉塞进每个节点里：
 * 塞进节点要给所有原语加 `relative`，而叠层（overlay）正是靠「只有内容区是 relative」来盖满整屏的。
 * 内容区尺寸或树变了就重量（ResizeObserver + 依赖 `revision`）。
 */
import * as React from "react";

export interface CommentPin { readonly nodeId: string; readonly n: number; readonly resolved: boolean }

export function CommentPins({ pins, container, revision }: {
  readonly pins: readonly CommentPin[];
  readonly container: React.RefObject<HTMLElement | null>;
  /** 树或尺寸的版本——变了就重新量。 */
  readonly revision: unknown;
}): React.ReactElement | null {
  const [pos, setPos] = React.useState<readonly { readonly pin: CommentPin; readonly x: number; readonly y: number }[]>([]);
  React.useLayoutEffect(() => {
    const root = container.current;
    if (root === null) return;
    const measure = () => {
      const base = root.getBoundingClientRect();
      // transform 放大（幻灯片）时 getBoundingClientRect 是放大后的尺寸，要按比例折回内容区自己的坐标。
      const k = root.offsetWidth > 0 ? base.width / root.offsetWidth : 1;
      setPos(pins.flatMap((pin) => {
        const el = root.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(pin.nodeId)}"]`);
        if (el === null) return [];
        const r = el.getBoundingClientRect();
        return [{ pin, x: (r.right - base.left) / k, y: (r.top - base.top) / k }];
      }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [pins, container, revision]);
  if (pos.length === 0) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-30">
      {pos.map(({ pin, x, y }) => (
        <span
          key={`${pin.nodeId}-${pin.n}`}
          data-testid="design-comment-pin" data-node={pin.nodeId} data-resolved={pin.resolved ? "true" : undefined}
          className="absolute flex h-5 min-w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-background bg-primary px-1 text-10 font-semibold text-primary-foreground shadow"
          style={{ left: x, top: y }}
        >
          {pin.n}
        </span>
      ))}
    </div>
  );
}
