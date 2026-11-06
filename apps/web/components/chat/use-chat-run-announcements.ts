"use client";
import * as React from "react";
import type { Locale } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/i18n/messages";
import { translate } from "@/lib/i18n/messages";
import { announceToChat } from "./chat-live-announcer";
import type { TraceStore } from "@/lib/chat-workbench/run-trace";

const activeStatuses = new Set(["running", "queued", "paused", "awaiting_tool_permission", "awaiting_plan_confirmation", "writeback_pending"]);

/** Only a live custom event or active authoritative restoration can establish identity. */
export function selectAnnouncementRun(events: TraceStore, restored: { runId: string | null; status: string | null }, liveRunId: string | null) {
  const event = [...(events[liveRunId ?? ""] ?? [])].reverse().find((item) => item.kind === "status");
  const live = { runId: liveRunId, status: event?.kind === "status" ? event.status : null,
    proof: liveRunId && event?.kind === "status" ? `${liveRunId}:${event.seq}:${event.status}` : null };
  if (activeStatuses.has(live.status ?? "")) return live;
  if (restored.runId && activeStatuses.has(restored.status ?? "")) return {
    runId: restored.runId, status: restored.status, proof: `${restored.runId}:restore:${restored.status}`,
  };
  // Historical hydrate() data and sticky Inspector IDs never establish a completion source.
  return live;
}

export interface ChatRunAnnouncementInput {
  readonly scope: string;
  readonly busy: boolean;
  readonly waiting: boolean;
  readonly paused: boolean;
  readonly hasError: boolean;
  readonly runId: string | null;
  readonly terminalStatus: string | null;
  /** Current run's durable status identity; a historical terminal cannot settle a new activity. */
  readonly terminalProof: string | null;
  readonly locale: Locale;
}

/** SDK transport stopping is not a business terminal: approval/restore can still be active. */
export function useChatRunAnnouncements({ scope, busy, waiting, paused, hasError, runId, terminalStatus, terminalProof, locale }: ChatRunAnnouncementInput): void {
  const state = React.useRef({ scope, active: false, baseline: terminalProof, baselineRunId: runId,
    activeRunId: null as string | null, settled: null as string | null });
  React.useEffect(() => {
    if (state.current.scope !== scope) {
      state.current = { scope, active: false, baseline: terminalProof, baselineRunId: runId, activeRunId: null, settled: null };
      announceToChat("");
    }
    let key: MessageKey | null = null;
    if (busy || waiting || paused) {
      if (!state.current.active) {
        state.current.baseline = terminalProof; state.current.baselineRunId = runId; state.current.activeRunId = null;
      }
      if (runId && activeStatuses.has(terminalStatus ?? "")) state.current.activeRunId = runId;
      state.current.active = true; state.current.settled = null;
      key = waiting ? "chatComposer.runtime.approval" : paused ? "chatComposer.runtime.paused" : "chatComposer.runtime.announceStart";
    } else if (hasError) {
      state.current.active = false;
      key = "chatComposer.runtime.announceFailure";
    } else if (terminalProof && (state.current.settled === terminalProof ||
      (state.current.active && runId && terminalProof !== state.current.baseline &&
        (runId !== state.current.baselineRunId || runId === state.current.activeRunId)))) {
      key = terminalStatus === "succeeded" ? "chatComposer.runtime.announceDone"
        : terminalStatus === "failed" ? "chatComposer.runtime.announceFailure"
          : terminalStatus === "cancelled" ? "chatComposer.runtime.announceStopped" : null;
      if (key) { state.current.active = false; state.current.settled = terminalProof; }
    }
    announceToChat(key ? translate(locale, key) : "");
  }, [scope, busy, waiting, paused, hasError, runId, terminalStatus, terminalProof, locale]);
}
