"use client";

import * as React from "react";

/** Debounce only eligible, applied drafts; failures require an explicit retry. */
export function useSurveyAutosave(key: string | null, save: () => Promise<void>) {
  const latest = React.useRef(save);
  React.useEffect(() => { latest.current = save; }, [save]);
  React.useEffect(() => {
    if (key === null) return;
    const timer = window.setTimeout(() => { void latest.current(); }, 1500);
    return () => window.clearTimeout(timer);
  }, [key]);
}
