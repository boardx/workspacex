"use client";

import * as React from "react";

export function useSectionNavigation(ids: string[], anchorPrefix: string) {
  const [activeId, setActiveId] = React.useState(ids[0] ?? "");
  const navigationLockUntil = React.useRef(0);
  const idsKey = ids.join("|");

  React.useEffect(() => {
    if (ids.length === 0) return;
    if (!ids.includes(activeId)) setActiveId(ids[0]!);
  }, [activeId, ids, idsKey]);

  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const elements = ids.map((id) => document.getElementById(`${anchorPrefix}-${id}`)).filter((element): element is HTMLElement => element !== null);
    const observer = new IntersectionObserver(() => {
      if (Date.now() < navigationLockUntil.current) return;
      const atDocumentEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
      if (atDocumentEnd) {
        setActiveId(ids.at(-1) ?? "");
        return;
      }
      const passed = elements.filter((element) => element.getBoundingClientRect().top <= 96);
      const current = passed.at(-1) ?? elements[0];
      const id = current?.getAttribute("data-section-id");
      if (id) setActiveId(id);
    }, { rootMargin: "-15% 0px -65% 0px", threshold: [0, 0.1, 0.5] });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [anchorPrefix, ids, idsKey]);

  const navigateTo = React.useCallback((id: string) => {
    navigationLockUntil.current = Date.now() + 1_000;
    setActiveId(id);
    const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(`${anchorPrefix}-${id}`)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }, [anchorPrefix]);

  return { activeId, navigateTo };
}
