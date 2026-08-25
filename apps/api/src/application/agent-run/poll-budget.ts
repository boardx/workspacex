/**
 * Single source of truth for "how long is a relay/bridge willing to keep polling a run
 * before giving up and reporting a timeout to the client".
 *
 * This value used to be declared independently in `stream-run.ts` (225 polls / ~90s) and
 * `agui-bridge.ts` (75 polls / ~30s). The two drifted apart: `stream-run.ts`'s REST relay
 * was deliberately set to ~90s to match the legacy `chat-live-message-panel.tsx` client's
 * own wait budget, but the newer copilotkit-v2 AG-UI bridge (`agui-bridge.ts`) kept the
 * ~30s default it was scaffolded with (#1963 DA-19a) and nobody re-aligned it. The result:
 * a slower agent run (e.g. a multi-block canvas template like a journey map, versus a
 * simpler one like a persona) reliably finished under the legacy panel's 90s budget but
 * timed out under copilotkit-v2's tighter 30s budget -- the client gave up polling well
 * before the run itself was done (the run keeps executing server-side either way; nothing
 * here cancels it -- giving up on polling only stops the client from ever hearing the
 * result).
 *
 * Both relays should use the same budget unless a caller has a specific reason to override
 * it (both `runAguiBridgeTurn`/`resumeAguiBridgeTurn` and `streamAgentRunDeltas` accept an
 * explicit `maxPolls`/`pollIntervalMs` on their input for that case). Change this constant,
 * not the call sites, if the shared budget itself needs to move.
 */
export const DEFAULT_RUN_POLL_INTERVAL_MS = 400;

/** ~90s bound at the default poll interval. */
export const DEFAULT_RUN_MAX_POLLS = 225;
