import { personalRealtimeTranscription as C } from "@repo/contracts";
import { apiRequest, apiWebSocketUrl, waitForSocketOpen } from "./api-client";
import { startPcmAudioWorklet, type PcmAudioWorkletHandle } from "./PcmAudioWorklet";
import type {
  RealtimeAsrFinalEvent, RealtimeAsrStreamError, RealtimeAsrStreamState, RealtimeAsrTicket,
} from "./realtime-asr.types";

export interface BoardxRealtimeAsrHandlers {
  onInterim(text: string): void;
  onFinal(event: RealtimeAsrFinalEvent): void;
  onState(state: RealtimeAsrStreamState): void;
  onError(reason: RealtimeAsrStreamError | "CONNECTION_FAILED"): void;
}

export interface BoardxRealtimeAsrHandle {
  readonly captureId: string;
  stop(): Promise<void>;
}

export async function issuePersonalRealtimeAsrTicket(
  sessionId: string,
  sessionToken?: string | null,
): Promise<RealtimeAsrTicket> {
  const input = C.operations.issueRealtimeAsrTicket.in.parse({ sessionId });
  const path = C.operations.issueRealtimeAsrTicket.path.replace(":sessionId", encodeURIComponent(input.sessionId));
  const raw = await apiRequest<unknown>(path, {
    method: C.operations.issueRealtimeAsrTicket.method,
    sessionToken,
  });
  return C.operations.issueRealtimeAsrTicket.out.parse(raw);
}

export async function openBoardxRealtimeAsr(
  sessionId: string,
  deps: {
    readonly sessionToken?: string | null;
    readonly handlers: BoardxRealtimeAsrHandlers;
    readonly issueTicket?: (sessionId: string, sessionToken?: string | null) => Promise<RealtimeAsrTicket>;
    readonly createSocket?: (url: string) => WebSocket;
    readonly capture?: () => Promise<PcmAudioWorkletHandle>;
    readonly handshakeTimeoutMs?: number;
  },
): Promise<BoardxRealtimeAsrHandle> {
  deps.handlers.onState("connecting");
  const ticket = await (deps.issueTicket ?? issuePersonalRealtimeAsrTicket)(sessionId, deps.sessionToken);
  const url = new URL(apiWebSocketUrl(ticket.websocketPath));
  url.searchParams.set(C.streamOperation.ticketQueryParameter, ticket.ticket);
  const socket = (deps.createSocket ?? ((target) => new WebSocket(target)))(url.toString());
  socket.binaryType = "arraybuffer";
  await waitForSocketOpen(socket, () => new Error("personal_realtime_asr_handshake_failed"), deps.handshakeTimeoutMs);

  let capture: PcmAudioWorkletHandle;
  try {
    capture = await (deps.capture ?? startPcmAudioWorklet)();
  } catch (error) {
    socket.close();
    throw error;
  }

  let completedResolve: (() => void) | undefined;
  let completedReject: ((error: Error) => void) | undefined;
  let completed = false;
  let stopping = false;
  let cleaningUp = false;
  let captureStopPromise: Promise<void> | undefined;
  const stopCaptureOnce = () => {
    captureStopPromise ??= capture.stop();
    return captureStopPromise;
  };
  const releaseResources = async () => {
    if (cleaningUp) return;
    cleaningUp = true;
    try {
      await stopCaptureOnce();
    } finally {
      socket.close();
    }
  };
  socket.addEventListener("message", (event) => {
    const parsed = C.RealtimeAsrServerEvent.safeParse(safeJson(String(event.data)));
    if (!parsed.success) {
      deps.handlers.onError("CONNECTION_FAILED");
      completedReject?.(new Error("invalid BoardX realtime ASR event"));
      void releaseResources();
      return;
    }
    const frame = parsed.data;
    if (frame.type === "ready") return deps.handlers.onState("recording");
    if (frame.type === "interim") return deps.handlers.onInterim(frame.text);
    if (frame.type === "final") return deps.handlers.onFinal(frame);
    if (frame.type === "stopping") return deps.handlers.onState("stopping");
    if (frame.type === "error") {
      deps.handlers.onState("error");
      deps.handlers.onError(frame.reason);
      completedReject?.(new Error(frame.reason));
      void releaseResources();
      return;
    }
    completed = true;
    deps.handlers.onState("idle");
    completedResolve?.();
  });
  socket.addEventListener("close", () => {
    if (completed || cleaningUp) return;
    if (stopping) {
      completedReject?.(new Error("ASR connection closed before completion"));
      void releaseResources();
      return;
    }
    deps.handlers.onState("error");
    deps.handlers.onError("CONNECTION_FAILED");
    void releaseResources();
  });

  socket.send(JSON.stringify({ type: "start" }));
  capture.onFrame((frame) => {
    if (socket.readyState === socket.OPEN) socket.send(frame);
  });

  return {
    captureId: ticket.captureId,
    stop: async () => {
      if (stopping) return;
      stopping = true;
      deps.handlers.onState("stopping");
      const completion = new Promise<void>((resolve, reject) => {
        completedResolve = resolve;
        completedReject = reject;
      });
      await stopCaptureOnce();
      if (socket.readyState !== socket.OPEN) throw new Error("ASR connection is not open");
      socket.send(JSON.stringify({ type: "stop" }));
      await completion;
      socket.close();
    },
  };
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}
