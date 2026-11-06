"use client";
import * as React from "react";
import type { Locale } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/i18n/messages";
import { translate } from "@/lib/i18n/messages";
import { announceToChat } from "./chat-live-announcer";

export interface ChatRunAnnouncementInput {
  readonly scope: string;
  readonly busy: boolean;
  readonly waiting: boolean;
  readonly paused: boolean;
  readonly hasError: boolean;
  readonly terminalStatus: string | null;
  /** Current run's durable status identity; a historical terminal cannot settle a new activity. */
  readonly terminalProof: string | null;
  readonly locale: Locale;
}

/** SDK transport stopping is not a business terminal: approval/restore can still be active. */
export function useChatRunAnnouncements({ scope, busy, waiting, paused, hasError, terminalStatus, terminalProof, locale }: ChatRunAnnouncementInput): void {
  const state = React.useRef({ scope, active: false, baseline: terminalProof, settled: null as string | null });
  React.useEffect(() => {
    if (state.current.scope !== scope) {
      state.current = { scope, active: false, baseline: terminalProof, settled: null };
      announceToChat("");
    }
    let key: MessageKey | null = null;
    if (busy || waiting || paused) {
      if (!state.current.active) state.current.baseline = terminalProof;
      state.current.active = true; state.current.settled = null;
      key = waiting ? "chatComposer.runtime.approval" : paused ? "chatComposer.runtime.paused" : "chatComposer.runtime.announceStart";
    } else if (hasError) {
      state.current.active = false;
      key = "chatComposer.runtime.announceFailure";
    } else if (terminalProof && (state.current.settled === terminalProof ||
      (state.current.active && terminalProof !== state.current.baseline))) {
      key = terminalStatus === "succeeded" ? "chatComposer.runtime.announceDone"
        : terminalStatus === "failed" ? "chatComposer.runtime.announceFailure"
          : terminalStatus === "cancelled" ? "chatComposer.runtime.announceStopped" : null;
      if (key) { state.current.active = false; state.current.settled = terminalProof; }
    }
    announceToChat(key ? translate(locale, key) : "");
  }, [scope, busy, waiting, paused, hasError, terminalStatus, terminalProof, locale]);
}
