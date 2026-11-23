"use client";
import * as React from "react";
import { ATTACHMENT_LIMITS, ATTACHMENT_MIME_ALLOWLIST } from "@repo/contracts/chat-file-upload";
import { ChatHostTextActionContext } from "./chat-host-panel";
import type { CopilotKitV2PanelViewProps } from "./copilotkit-v2-panel-body";

/** Optional workspace actions reuse the actual composer queue; they never submit a tool decision. */
export function ChatHostActionsBridge({ view, children }: { view: CopilotKitV2PanelViewProps; children: React.ReactNode }) {
  const scope = JSON.stringify([view.projectId, view.resolvedChatThreadId]);
  const token = view.sessionToken;
  const latest = React.useRef({ scope, view }); latest.current = { scope, view };
  const occupied = !!view.inputDraft.trim() || view.attach.attachments.length > 0 || ["connecting", "listening", "stopping"].includes(view.voice.phase);
  const available = view.hostRunPresent && !view.sendIsBlocked && !view.historyLoading && view.isRegisteredAgentReady;
  const offerAudioDraft = React.useCallback((file: File, instruction: string): "accepted" | "occupied" | "unavailable" => {
    const current = latest.current;
    const v = current.view;
    if (current.scope !== scope || v.sessionToken !== token || !v.projectId || !v.resolvedChatThreadId || !v.hostRunPresent || v.sendIsBlocked || v.historyLoading || !v.isRegisteredAgentReady) return "unavailable";
    if (v.inputDraft.trim() || v.attach.attachments.length || ["connecting", "listening", "stopping"].includes(v.voice.phase)) return "occupied";
    if (!(file instanceof File) || file.size < 1 || file.size > ATTACHMENT_LIMITS.maxBytesPerFile || !["audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg"].includes(file.type) || !(ATTACHMENT_MIME_ALLOWLIST as readonly string[]).includes(file.type) || !instruction.trim() || instruction.length > 4000) return "unavailable";
    // Both are the existing native composer operations. Upload progress/error stays
    // in its canonical attachment strip, and only the normal Send button runs AI.
    v.setInputDraft(instruction);
    v.attach.pickFiles([file]);
    return "accepted";
  }, [scope, token]);
  return <ChatHostTextActionContext.Provider value={{ projectId: view.projectId ?? null, threadId: view.resolvedChatThreadId ?? null,
    available, running: view.runIsRunning, failed: Boolean(view.error), occupied, sendText: view.requestHostText, offerAudioDraft }}>{children}</ChatHostTextActionContext.Provider>;
}
