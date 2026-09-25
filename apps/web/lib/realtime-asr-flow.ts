export type RealtimeAsrFlowState = "normal" | "slow";

const PCM16_MONO_BYTES_PER_SECOND = 32_000;
export const BROWSER_SLOW_BACKLOG_MS = 400;
export const BROWSER_RECOVERY_BACKLOG_MS = 200;
export const BROWSER_TERMINAL_BACKLOG_MS = 1_000;

export function pcm16MonoQueuedMs(bytes: number): number {
  return Math.round(bytes * 1_000 / PCM16_MONO_BYTES_PER_SECOND);
}

export function browserAudioFlowState(
  previous: RealtimeAsrFlowState,
  bufferedBytes: number,
): { readonly state: RealtimeAsrFlowState; readonly queuedMs: number } {
  const queuedMs = pcm16MonoQueuedMs(bufferedBytes);
  if (previous === "normal" && queuedMs >= BROWSER_SLOW_BACKLOG_MS) return { state: "slow", queuedMs };
  if (previous === "slow" && queuedMs <= BROWSER_RECOVERY_BACKLOG_MS) return { state: "normal", queuedMs };
  return { state: previous, queuedMs };
}

export function combinedFlowState(
  browser: RealtimeAsrFlowState,
  upstream: RealtimeAsrFlowState,
): RealtimeAsrFlowState {
  return browser === "slow" || upstream === "slow" ? "slow" : "normal";
}
