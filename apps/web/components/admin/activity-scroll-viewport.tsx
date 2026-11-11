"use client";
import * as React from "react";

/** Keep five complete activity rows visible, including when cells wrap. */
export function ActivityScrollViewport({ children, label }: { children: React.ReactNode; label: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const viewport = ref.current;
    const table = viewport?.querySelector("table");
    if (!viewport || !table) return;
    const measure = () => {
      const rows = table.querySelectorAll("tbody tr");
      if (rows.length <= 5) {
        viewport.style.maxHeight = "";
        return;
      }
      const bottom = rows[4].getBoundingClientRect().bottom;
      viewport.style.maxHeight = `${Math.ceil(bottom - table.getBoundingClientRect().top)}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(table);
    return () => observer.disconnect();
  }, [children]);
  return <div ref={ref} role="region" aria-label={label} tabIndex={0}
    className="overflow-auto" data-testid="admin-activity-scroll">{children}</div>;
}
