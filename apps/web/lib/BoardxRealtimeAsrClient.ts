import { personalRealtimeTranscription as C } from "@repo/contracts";
import { apiRequest, apiWebSocketUrl, waitForSocketOpen } from "./api-client";
import { stopPersonalTranscription } from "./live-personal-transcriptions";
import { startPcmAudioWorklet, type PcmAudioWorkletHandle } from "./PcmAudioWorklet";
import { pcm16Level } from "./pcm-audio-level";
import { browserAudioFlowState, combinedFlowState, type RealtimeAsrFlowState } from "./realtime-asr-flow";
import type {
  RealtimeAsrFinalEvent, RealtimeAsrFlowEvent, RealtimeAsrStreamError, RealtimeAsrStreamState, RealtimeAsrTicket,
} from "./realtime-asr.types";

export interface BoardxRealtimeAsrHandlers {
  onInterim(text: string): void;
  onFinal(event: RealtimeAsrFinalEvent): void;
  onLevel?(level: number): void;
  onFlow?(event: RealtimeAsrFlowEvent | { readonly type: "flow"; readonly state: RealtimeAsrFlowState; readonly source: "browser"; readonly queuedMs: number }): void;
  onState(state: RealtimeAsrStreamState): void;
  onError(reason: RealtimeAsrStreamError | "CONNECTION_FAILED"): void;
}

export interface BoardxRealtimeAsrHandle {
  readonly captureId: string;
  stop(): Promise<void>;
}

/** One second of mono PCM16/16kHz; beyond this, "realtime" has already been lost. */
const MAX_SOCKET_AUDIO_BACKLOG_BYTES = 32_000;

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
    readonly deviceId?: string;
    readonly handlers: BoardxRealtimeAsrHandlers;
    readonly issueTicket?: (sessionId: string, sessionToken?: string | null) => Promise<RealtimeAsrTicket>;
    readonly createSocket?: (url: string) => WebSocket;
    readonly capture?: (options: { readonly deviceId?: string }) => Promise<PcmAudioWorkletHandle>;
    readonly cleanupCapture?: (sessionId: string, sessionToken?: string | null) => Promise<unknown>;
    readonly handshakeTimeoutMs?: number;
    readonly finishTimeoutMs?: number;
  },
): Promise<BoardxRealtimeAsrHandle> {
  deps.handlers.onState("connecting");
  const ticket = await (deps.issueTicket ?? issuePersonalRealtimeAsrTicket)(sessionId, deps.sessionToken);
  const url = new URL(apiWebSocketUrl(ticket.websocketPath));
  url.searchParams.set(C.streamOperation.ticketQueryParameter, ticket.ticket);
  const socket = (deps.createSocket ?? ((target) => new WebSocket(target)))(url.toString());
  socket.binaryType = "arraybuffer";
  const cleanupReservedCapture = async () => {
    try {
      await (deps.cleanupCapture ?? stopPersonalTranscription)(sessionId, deps.sessionToken);
    } catch {
      // Preserve the startup failure. The stop endpoint is best-effort recovery for the
      // capture reserved when the ticket was issued; it must not mask the root cause.
    }
  };
  try {
    await waitForSocketOpen(socket, () => new Error("personal_realtime_asr_handshake_failed"), deps.handshakeTimeoutMs);
  } catch (error) {
    socket.close();
    await cleanupReservedCapture();
    throw error;
  }

  let completedResolve!: () => void;
  let completedReject!: (error: Error) => void;
  const completion = new Promise<void>((resolve, reject) => {
    completedResolve = resolve;
    completedReject = reject;
  });
  // Errors may arrive before the user presses stop; retain the outcome without
  // creating an unhandled rejection while no stop caller is waiting yet.
  void completion.catch(() => undefined);
  let completed = false;
  let browserFlow: RealtimeAsrFlowState = "normal";
  let upstreamFlow: RealtimeAsrFlowState = "normal";
  const emitFlow = () => deps.handlers.onFlow?.({ type: "flow", state: combinedFlowState(browserFlow, upstreamFlow), source: "browser", queuedMs: 0 });
  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  let captureStop: Promise<void> | undefined;
  let capture: PcmAudioWorkletHandle | undefined;
  const stopCapture = () => capture ? captureStop ??= capture.stop() : Promise.resolve();
  let startupTerminalError: Error | undefined;
  let cleaningUp = false;
  const releaseResources = () => {
    if (cleaningUp) return;
    cleaningUp = true;
    deps.handlers.onLevel?.(0);
    // Closing the transport must not depend on AudioContext.close succeeding.
    void stopCapture().catch(() => undefined);
    socket.close();
  };
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  let readySettled = false;
  const providerReady = new Promise<void>((resolve, reject) => {
    readyResolve = () => { readySettled = true; resolve(); };
    readyReject = (error) => { readySettled = true; reject(error); };
  });
  socket.addEventListener("message", (event) => {
    const parsed = C.RealtimeAsrServerEvent.safeParse(safeJson(String(event.data)));
    if (!parsed.success) {
      startupTerminalError ??= new Error("invalid BoardX realtime ASR event");
      deps.handlers.onError("CONNECTION_FAILED");
      if (!readySettled) readyReject(new Error("invalid BoardX realtime ASR event"));
      completedReject?.(new Error("invalid BoardX realtime ASR event"));
      void releaseResources();
      return;
    }
    const frame = parsed.data;
    if (frame.type === "ready") {
      if (!readySettled) readyResolve();
      return;
    }
    if (frame.type === "interim") return deps.handlers.onInterim(frame.text);
    if (frame.type === "final") return deps.handlers.onFinal(frame);
    if (frame.type === "flow") { upstreamFlow = frame.state; emitFlow(); return; }
    if (frame.type === "stopping") return deps.handlers.onState("stopping");
    if (frame.type === "error") {
      startupTerminalError ??= new Error(frame.reason);
      deps.handlers.onState("error");
      deps.handlers.onError(frame.reason);
      if (!readySettled) readyReject(new Error(frame.reason));
      completedReject?.(new Error(frame.reason));
      void releaseResources();
      return;
    }
    startupTerminalError ??= new Error("ASR completed before capture started");
    completed = true;
    deps.handlers.onState("idle");
    completedResolve();
    releaseResources();
  });
  socket.addEventListener("close", () => {
    if (completed || cleaningUp) return;
    if (stopping) {
      const error = new Error("ASR connection closed before completion");
      startupTerminalError ??= error;
      completedReject?.(error);
      void releaseResources();
      return;
    }
    const error = new Error("CONNECTION_FAILED");
    startupTerminalError ??= error;
    if (!readySettled) readyReject(error);
    completedReject(error);
    deps.handlers.onState("error");
    deps.handlers.onError("CONNECTION_FAILED");
    void releaseResources();
  });

  socket.send(JSON.stringify({ type: "start" }));
  try {
    await providerReady;
    capture = await (deps.capture ?? startPcmAudioWorklet)({ deviceId: deps.deviceId });
    if (cleaningUp || completed || socket.readyState !== socket.OPEN) {
      try { await stopCapture(); } catch { /* Preserve the transport terminal cause. */ }
      throw startupTerminalError ?? new Error("ASR connection terminated during microphone startup");
    }
  } catch (error) {
    releaseResources();
    await cleanupReservedCapture();
    throw error;
  }

  capture.onFrame((frame) => {
    if (!completed && !cleaningUp && socket.readyState === socket.OPEN) {
      deps.handlers.onLevel?.(pcm16Level(new Int16Array(frame)));
      const nextFlow = browserAudioFlowState(browserFlow, socket.bufferedAmount);
      if (nextFlow.state !== browserFlow) { browserFlow = nextFlow.state; emitFlow(); }
      if (socket.bufferedAmount > MAX_SOCKET_AUDIO_BACKLOG_BYTES) {
        const error = new Error("AUDIO_BACKPRESSURE");
        deps.handlers.onState("error");
        deps.handlers.onError("AUDIO_BACKPRESSURE");
        completedReject(error);
        releaseResources();
        return;
      }
      socket.send(frame);
    }
  });
  deps.handlers.onState("recording");

  return {
    captureId: ticket.captureId,
    stop: () => {
      if (stopPromise) return stopPromise;
      stopping = true;
      deps.handlers.onState("stopping");
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error("FINISH_TIMEOUT");
          completedReject(error);
          reject(error);
        }, deps.finishTimeoutMs ?? 30_000);
      });
      const finish = async () => {
        if (!completed && !cleaningUp) {
          await stopCapture();
          if (!completed && !cleaningUp) {
            if (socket.readyState !== socket.OPEN) throw new Error("CONNECTION_FAILED");
            socket.send(JSON.stringify({ type: "stop" }));
          }
        }
        await completion;
      };
      stopPromise = Promise.race([finish(), timeout]).finally(() => {
        clearTimeout(timer);
        releaseResources();
      });
      return stopPromise;
    },
  };
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}
