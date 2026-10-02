"use client";

import { Cloud, CloudOff, LoaderCircle } from "lucide-react";
import type { WhiteboardConnectionState } from "@/lib/whiteboard-provider";

export type BoardSyncVisualState = "connecting" | "syncing" | "offline" | "saved" | "blocked";
export function boardSyncVisualState(state: Pick<WhiteboardConnectionState, "phase" | "pending">): BoardSyncVisualState {
  if (state.phase !== "online") return state.phase;
  return state.pending > 0 ? "syncing" : "saved";
}

/** Detailed transport feedback remains accessible without covering the canvas. */
export function BoardSyncIndicator({ status, readOnly, syncState, onRetry }: { status: string; readOnly: boolean; syncState?: BoardSyncVisualState; onRetry?: () => void }) {
  const state = syncState ?? (/^已同步(?: · 序列 \d+)?$/.test(status) ? "saved" : /连接中断|离线/.test(status) ? "offline" : "connecting");
  const busy = state === "connecting" || state === "syncing", offline = state === "offline";
  const description = status + (readOnly ? " · 只读" : "");
  const icon = offline || state === "blocked" ? <CloudOff aria-hidden className="h-5 w-5" /> : busy ? <LoaderCircle data-testid="board-sync-spinner" aria-hidden className="h-5 w-5 animate-spin motion-reduce:animate-none" /> : <Cloud aria-hidden className="h-5 w-5" />;
  return <span data-testid="board-sync-status" data-sync-state={state} role="status" aria-label={description} title={description} className="flex shrink-0 items-center gap-2 whitespace-nowrap text-13 text-muted-foreground">
    {offline && onRetry ? <button type="button" data-testid="board-retry-sync" aria-label="同步连接中断，立即重连" title="立即重连" onClick={onRetry} className="grid min-h-11 min-w-11 place-items-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{icon}</button> : icon}
    <span className={state === "saved" ? "hidden xl:inline" : "sr-only"}>{state === "saved" ? "已同步" : description}</span>
    {readOnly && state === "saved" ? <span className="hidden xl:inline">只读</span> : null}
  </span>;
}
