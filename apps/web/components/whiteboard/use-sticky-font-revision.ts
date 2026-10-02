"use client";

import { useEffect, useState } from "react";
import { cache } from "fabric";
import { watchStickyFontLayouts } from "./fabric/sticky-text-layout";

export function useStickyFontRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!document.fonts) return;
    const pointer = {
      on: (type: "mouse:down" | "mouse:up", listener: () => void) => window.addEventListener(type === "mouse:down" ? "mousedown" : "mouseup", listener),
      off: (type: "mouse:down" | "mouse:up", listener: () => void) => window.removeEventListener(type === "mouse:down" ? "mousedown" : "mouseup", listener),
    };
    return watchStickyFontLayouts(document.fonts, pointer, () => {
      cache.clearFontCache();
      setRevision((current) => current + 1);
    });
  }, []);
  return revision;
}
