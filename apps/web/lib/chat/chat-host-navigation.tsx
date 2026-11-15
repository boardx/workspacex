"use client";
import * as React from "react";

export type ChatHostNavigation = Readonly<{ projectId: string; returnHref: string }>;
const Navigation = React.createContext<ChatHostNavigation | null>(null);
export function ChatHostNavigationProvider({ value, children }: { value: ChatHostNavigation; children: React.ReactNode }) {
  return <Navigation.Provider value={value}>{children}</Navigation.Provider>;
}
/** Navigation is presentation only. It never grants access to a target resource. */
export function safeChatHostReturnHref(value: string | null | undefined): string | undefined {
  if (!value || value !== value.trim() || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return undefined;
  try {
    const parsed = new URL(value, "https://workspace.invalid");
    if (parsed.origin !== "https://workspace.invalid") return undefined;
    let path = parsed.pathname;
    // Check repeated encoding without changing the returned path or its opaque IDs.
    for (let depth = 0; depth < 6; depth++) {
      if (path.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(path) || /^\/[a-z][a-z0-9+.-]*:/i.test(path)) return undefined;
      if (/%(?![0-9a-f]{2})/i.test(path)) return undefined;
      if (!/%[0-9a-f]{2}/i.test(path)) return value;
      path = decodeURIComponent(path);
    }
  } catch { return undefined; }
  return undefined;
}
export function useChatHostReturnHref(projectId: string | undefined): string | undefined {
  const navigation = React.useContext(Navigation);
  return navigation && projectId && navigation.projectId === projectId ? safeChatHostReturnHref(navigation.returnHref) : undefined;
}
export function chatBoardHandoffHref({ boardId, projectId, artifactId, layoutHash, returnHref }: {
  boardId: string; projectId?: string; artifactId: string; layoutHash: string; returnHref?: string;
}): string {
  const returnTo = safeChatHostReturnHref(returnHref);
  return `/studio/board/${encodeURIComponent(boardId)}?${new URLSearchParams({ ...(projectId ? { projectId } : {}), focusArtifact: artifactId, focusLayout: layoutHash, ...(returnTo ? { returnTo } : {}) })}`;
}
