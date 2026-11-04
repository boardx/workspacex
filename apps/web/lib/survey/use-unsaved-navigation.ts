"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n/provider";

type NavigationSurface = EventTarget;
type SurveyNavigateEvent = Event & { navigationType: string };

/** Protect edits before Next's router commits a navigation. History traversal uses
 * the Navigation API, not popstate: popstate fires after the URL has changed and
 * rolling it back can unmount the editor or corrupt the user's Forward stack.
 * Browsers without this API retain link and native document-unload protection.
 */
export function useSurveyUnsavedNavigation(
  dirty: boolean,
  message?: string,
): void {
  const { t } = useI18n();
  const currentMessage = useRef(message ?? t("survey.workspace.unsavedConfirm"));
  currentMessage.current = message ?? t("survey.workspace.unsavedConfirm");
  useEffect(() => {
    if (!dirty) return;
    const navigation = (window as unknown as { navigation?: NavigationSurface }).navigation;
    let approvedUnload = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const resetApproval = () => { approvedUnload = false; clearTimeout(expiry); };
    const approve = () => {
      approvedUnload = true;
      clearTimeout(expiry);
      // A cancelled link must not disable protection indefinitely.
      expiry = setTimeout(resetApproval, 1000);
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (approvedUnload) { resetApproval(); return; }
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const target = new URL(link.href, window.location.href);
      if (!["http:", "https:"].includes(target.protocol)) return;
      if (target.origin === location.origin && target.pathname === location.pathname && target.search === location.search) return;
      if (window.confirm(currentMessage.current)) approve();
      else { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const traverse = (event: Event) => {
      if ((event as SurveyNavigateEvent).navigationType !== "traverse" || event.defaultPrevented || !event.cancelable) return;
      if (window.confirm(currentMessage.current)) approve();
      else event.preventDefault();
    };
    document.addEventListener("click", click, true);
    window.addEventListener("beforeunload", unload);
    navigation?.addEventListener("navigate", traverse);
    navigation?.addEventListener("navigateerror", resetApproval);
    navigation?.addEventListener("navigatesuccess", resetApproval);
    return () => {
      resetApproval();
      document.removeEventListener("click", click, true);
      window.removeEventListener("beforeunload", unload);
      navigation?.removeEventListener("navigate", traverse);
      navigation?.removeEventListener("navigateerror", resetApproval);
      navigation?.removeEventListener("navigatesuccess", resetApproval);
    };
  }, [dirty]);
}
