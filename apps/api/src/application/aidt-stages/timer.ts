import type { AidtTimer, AidtTimerAction } from "@repo/contracts/aidt-stages";

export function transitionAidtTimer(timer: AidtTimer | null, command: AidtTimerAction, nowMs: number): AidtTimer | null {
  if (command.action === "close") return null;
  if (command.action === "start") return { remainingMs: 0, endsAtMs: nowMs + command.durationMs };
  if (!timer) return null;

  const remainingMs = timer.endsAtMs === null ? timer.remainingMs : Math.max(0, timer.endsAtMs - nowMs);
  if (command.action === "pause" && timer.endsAtMs !== null) return { remainingMs, endsAtMs: null };
  if (command.action === "resume" && timer.endsAtMs === null && remainingMs > 0) {
    return { remainingMs: 0, endsAtMs: nowMs + remainingMs };
  }
  if (command.action === "add") {
    const total = Math.min(86_400_000, remainingMs + command.durationMs);
    return timer.endsAtMs === null ? { remainingMs: total, endsAtMs: null } : { remainingMs: 0, endsAtMs: nowMs + total };
  }
  return timer;
}
