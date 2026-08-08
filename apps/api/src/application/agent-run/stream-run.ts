/**
 * `streamAgentRunDeltas` -- #654 阶段2c: an SSE relay for an ALREADY-CREATED run.
 *
 * ## Why this is not `agui-bridge.ts`
 *
 * `runAguiBridgeTurn` always opens a FRESH personal Chat thread per turn (see that file's
 * own head) -- a deliberate阶段1b scope limit that `chat-live-message-panel.tsx`'s own
 * commit history (PR #670) flagged as the reason production `/chat` could not switch its
 * SEND mechanism to the bridge without breaking "continue this conversation" for an
 * existing thread. This function sidesteps that limit entirely by not creating anything:
 * it takes a `runId` that ALREADY EXISTS (created the ordinary way, through
 * `POST /chat/threads/:id/messages` -> `acceptHumanMessage`, exactly as production does
 * today) and only relays what happens to it. Production's send path does not change at
 * all; this is purely an additive READ-side relay.
 *
 * ## `GET /agent-runs/:runId` is untouched
 *
 * That endpoint's own file head says "polling, not SSE" and remains true for itself --
 * this is a NEW, second way to observe the same run, not a replacement. A client that
 * cannot or does not want an SSE connection keeps using the polling endpoint exactly as
 * before; nothing here changes its contract, response shape, or behaviour.
 *
 * ## Same visibility decision as the polling read, on every iteration
 *
 * `readAgentRun` re-derives visibility each poll (see that file's own head for why it is
 * NOT a shortcut check) -- this function calls it the same way, at the same cadence a
 * client polling `GET /agent-runs/:runId` on its own would have. Re-deriving it per
 * iteration, rather than once at connection start, means a thread archived or a
 * membership revoked WHILE this connection is open stops the relay on the next tick
 * instead of leaking further content to a viewer who has already lost access.
 */
import type { OrgId } from "../../domain/org-id";
import type { ResolveVisibilityDeps } from "../chat/resolve-visibility";
import type { AgentRunStore } from "./ports";
import { readAgentRun } from "./read-run";

export interface StreamRunDeps extends ResolveVisibilityDeps {
  readonly runs: AgentRunStore;
}

export interface StreamRunInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly runId: string;
  /** Fired, in `seq` order, for every fragment observed -- before this call returns. */
  readonly onDelta: (delta: string) => void;
  /** Test seam only -- production callers use the defaults. */
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
}

export type StreamRunOutcome =
  | { readonly kind: "succeeded"; readonly resultMessageId: string | null }
  | { readonly kind: "failed"; readonly error: string | null }
  | { readonly kind: "timeout" };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function streamAgentRunDeltas(
  deps: StreamRunDeps,
  input: StreamRunInput,
): Promise<StreamRunOutcome> {
  const pollIntervalMs = input.pollIntervalMs ?? 400;
  // ~90s bound at the default interval -- matches `chat-live-message-panel.tsx`'s own
  // `RUN_POLL_BUDGET_MS`, so switching a client from polling to this relay does not
  // silently change how long it is willing to wait before giving up.
  const maxPolls = input.maxPolls ?? 225;
  let lastSeenDeltaSeq = -1;

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const deltas = await deps.runs.readModelDeltas(input.orgId, input.runId, lastSeenDeltaSeq);
    for (const delta of deltas) {
      input.onDelta(delta.text);
      lastSeenDeltaSeq = delta.seq;
    }
    const projection = await readAgentRun(deps, {
      userId: input.userId, orgId: input.orgId, runId: input.runId,
    });
    if (projection.status === "succeeded") {
      return { kind: "succeeded", resultMessageId: projection.resultMessageId };
    }
    if (projection.status === "failed") {
      return { kind: "failed", error: projection.error };
    }
    await sleep(pollIntervalMs);
  }
  return { kind: "timeout" };
}
