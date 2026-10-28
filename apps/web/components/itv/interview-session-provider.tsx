"use client";
import * as React from "react";
import { InterviewSessionCache } from "@/lib/interview-session-cache";
import { loadInterviewMarkdown, type InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";

export const InterviewSessionContext = React.createContext<InterviewSessionCache | null>(null);
const emptySubscribe = () => () => {};
export function useInterviewSessionValue<T>(key: string) {
  const cache = React.useContext(InterviewSessionContext);
  const snapshot = React.useCallback(() => cache?.get<T>(key) ?? null, [cache, key]);
  return { cache, value: React.useSyncExternalStore(cache?.subscribe ?? emptySubscribe, snapshot, () => null) };
}
export function InterviewSessionProvider({ children }: { children: React.ReactNode }) {
  const [cache] = React.useState(() => new InterviewSessionCache());
  React.useEffect(() => { cache.resume(); return () => cache.dispose(); }, [cache]);
  return <InterviewSessionContext.Provider value={cache}>{children}</InterviewSessionContext.Provider>;
}

export function useInterviewRevalidation(key: string, refresh: () => Promise<unknown>) {
  const cache = React.useContext(InterviewSessionContext);
  React.useEffect(() => {
    if (!cache) return;
    return cache.retain(key, () => {
      const reload = () => { if (document.visibilityState !== "hidden") void refresh().catch(() => {}); };
      window.addEventListener("focus", reload); window.addEventListener("online", reload);
      document.addEventListener("visibilitychange", reload);
      const timer = window.setInterval(reload, 30000);
      return () => {
        window.clearInterval(timer); window.removeEventListener("focus", reload); window.removeEventListener("online", reload);
        document.removeEventListener("visibilitychange", reload);
      };
    });
  }, [cache, key, refresh]);
}

/** Standalone legacy surfaces retain local state; named routes share their layout. */
export function useInterviewSource(interviewId: string) {
  const key = `source/${interviewId}`;
  const { cache, value: shared } = useInterviewSessionValue<InterviewMarkdownEnvelope>(key);
  const { value: syncError } = useInterviewSessionValue<string>(`sync-error/${interviewId}`);
  const [local, setLocal] = React.useState<InterviewMarkdownEnvelope | null>(null);
  const setSource = React.useCallback((next: InterviewMarkdownEnvelope | null) => {
    if (!next || next.interviewId !== interviewId) return;
    if (cache) cache.put(key, next); else setLocal(previous => !previous || next.version >= previous.version ? next : previous);
  }, [cache, key, interviewId]);
  const refresh = React.useCallback(async () => {
    const read = () => loadInterviewMarkdown(interviewId);
    try {
      const next = await (cache ? cache.read(key, read) : read());
      cache?.put(`sync-error/${interviewId}`, ""); return next;
    } catch (cause) { cache?.put(`sync-error/${interviewId}`, "最新访谈数据同步失败，已显示的内容保留。"); throw cause; }
  }, [cache, key, interviewId]);
  useInterviewRevalidation(key, refresh);
  return { source: cache ? shared : local?.interviewId === interviewId ? local : null, setSource, refresh, cache, syncError };
}
