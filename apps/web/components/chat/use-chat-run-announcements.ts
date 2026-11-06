"use client";
import * as React from "react";
import type { Locale } from "@/lib/i18n/locale";
import { translate, type MessageKey } from "@/lib/i18n/messages";
import type { LiveRunSignal } from "@/lib/chat-workbench/use-run-trace";
import { announceToChat } from "./chat-live-announcer";

const activeStatuses = new Set(["running", "queued", "paused", "awaiting_tool_permission", "awaiting_plan_confirmation", "writeback_pending"]);
const proofOf = (event: LiveRunSignal["event"]) => event ? `${event.runId}:${event.seq}:${event.status}` : null;
export interface ChatRunAnnouncementInput {
  readonly scope: string;
  readonly busy: boolean;
  readonly waiting: boolean;
  readonly hasError: boolean;
  readonly live: LiveRunSignal;
  readonly restored: { readonly runId: string | null; readonly status: string | null };
  readonly locale: Locale;
}

/** Completion comes from actual stream provenance, never historical journal hydration. */
export function useChatRunAnnouncements({ scope, busy, waiting, hasError, live, restored, locale }: ChatRunAnnouncementInput): void {
  const proof = proofOf(live.event), generation = live.generation;
  const eventRunId = live.event?.runId ?? null, eventStatus = live.event?.status ?? null;
  const state = React.useRef({ scope, generation, lastLiveProof: proof, activeRunId: null as string | null,
    settled: null as string | null, delivered: new Set<string>() });
  React.useEffect(() => {
    if (state.current.scope !== scope) {
      state.current = { scope, generation, lastLiveProof: proof, activeRunId: null, settled: null, delivered: new Set() };
      announceToChat("");
    }
    if (state.current.generation !== generation) {
      state.current.generation = generation; state.current.activeRunId = null; state.current.settled = null;
    }
    const restoredActive = restored.runId !== null && activeStatuses.has(restored.status ?? "");
    const freshLive = proof !== null && proof !== state.current.lastLiveProof;
    if (freshLive) {
      state.current.lastLiveProof = proof;
      if (!state.current.delivered.has(proof) && (!restoredActive || restored.runId === eventRunId || activeStatuses.has(eventStatus ?? ""))) {
        state.current.activeRunId = eventRunId;
      }
    }
    if (restoredActive && !(freshLive && activeStatuses.has(eventStatus ?? ""))) state.current.activeRunId = restored.runId;
    const paused = restoredActive ? restored.status === "paused" : state.current.activeRunId === eventRunId && eventStatus === "paused";
    let key: MessageKey | null = null;
    if (busy || waiting || paused || restoredActive) {
      state.current.settled = null;
      key = waiting ? "chatComposer.runtime.approval" : paused ? "chatComposer.runtime.paused" : "chatComposer.runtime.announceStart";
    } else if (hasError) key = "chatComposer.runtime.announceFailure";
    else if (proof && state.current.activeRunId === eventRunId &&
      (state.current.settled === proof || !state.current.delivered.has(proof))) {
      key = eventStatus === "succeeded" ? "chatComposer.runtime.announceDone"
        : eventStatus === "failed" ? "chatComposer.runtime.announceFailure"
          : eventStatus === "cancelled" ? "chatComposer.runtime.announceStopped" : null;
      if (key) { state.current.settled = proof; state.current.delivered.add(proof); }
    }
    announceToChat(key ? translate(locale, key) : "");
  }, [scope, busy, waiting, hasError, generation, proof, eventRunId, eventStatus, restored.runId, restored.status, locale]);
}
