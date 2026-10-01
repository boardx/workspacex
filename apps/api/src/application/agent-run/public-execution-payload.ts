import { redactErrorMessage } from "../ports/error-log.port";

/** Public trace uses the existing bounded summaries, never full tool transcripts. */
export function publicExecutionPayload(summary: string | null): unknown {
  if (summary === null) return null;
  const clean = (value: unknown): unknown => {
    if (typeof value === "string") return redactErrorMessage(value);
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key,
        /password|secret|token|authorization|api[_-]?key|credential/i.test(key) ? "[REDACTED]" : clean(item)]),
    );
    return value;
  };
  try { return clean(JSON.parse(summary)); } catch { return redactErrorMessage(summary); }
}

/** Persist the same redacted projection in legacy step summaries. */
export function publicExecutionSummary(summary: string | null): string | null {
  if (summary === null) return null;
  const value = publicExecutionPayload(summary);
  return typeof value === "string" ? value : JSON.stringify(value);
}
