/**
 * Phase 14 F03 -- the production implementation of `RunEventBusPort` (see that file's own
 * doc for why in-memory is a faithful choice for THIS deployment, not a shortcut).
 */
import type { OrgId } from "../../domain/org-id";
import type { KernelStreamEvent, RunEventBusPort } from "../../application/agent-run/run-event-bus";

interface RunBucket {
  readonly orgId: OrgId;
  readonly events: KernelStreamEvent[];
  readonly listeners: Set<(event: KernelStreamEvent) => void>;
  nextSeq: number;
}

/**
 * Bounded so a long-lived process cannot grow this without limit. An event bus is a REPLAY
 * BUFFER for reconnect (R3 步骤 4), not the durable record -- the ledger (`agent_run_steps`
 * etc.) already is that, see `run-event-bus.ts`'s own doc. Both caps are generous relative to
 * any single run's real event volume; they exist to bound a pathological run/process
 * lifetime, not to be hit in the normal case. Dropping the oldest event when a run exceeds
 * `MAX_EVENTS_PER_RUN` only degrades an EXTREMELY long-lived run's earliest reconnect
 * history -- the ledger remains the source of truth for anything that old.
 */
const MAX_EVENTS_PER_RUN = 5_000;
const MAX_TRACKED_RUNS = 2_000;

export class InMemoryRunEventBus implements RunEventBusPort {
  private readonly runs = new Map<string, RunBucket>();

  publish(orgId: OrgId, runId: string, build: (seq: number) => KernelStreamEvent): void {
    const bucket = this.bucketFor(orgId, runId);
    const seq = bucket.nextSeq;
    bucket.nextSeq += 1;
    let event: KernelStreamEvent;
    try {
      event = build(seq);
    } catch {
      // A malformed event is a bug in the CALLER, not something a live subscriber should
      // crash on -- and propagating it would defeat "fire-and-forget" by turning a
      // publish-time bug into a control-flow exception inside `execute-run.ts` itself.
      return;
    }
    bucket.events.push(event);
    if (bucket.events.length > MAX_EVENTS_PER_RUN) bucket.events.shift();
    for (const listener of bucket.listeners) {
      try {
        listener(event);
      } catch {
        // One bad subscriber (a socket mid-close, a listener that throws) must not stop
        // delivery to every OTHER subscriber of the same run, and must never propagate back
        // into the publisher's own call stack (`execute-run.ts`'s execution).
      }
    }
  }

  subscribe(
    orgId: OrgId,
    runId: string,
    afterSeq: number,
    onEvent: (event: KernelStreamEvent) => void,
  ): () => void {
    const bucket = this.bucketFor(orgId, runId);
    for (const event of bucket.events) {
      if (event.seq > afterSeq) onEvent(event);
    }
    bucket.listeners.add(onEvent);
    return () => bucket.listeners.delete(onEvent);
  }

  private bucketFor(orgId: OrgId, runId: string): RunBucket {
    let bucket = this.runs.get(runId);
    if (bucket === undefined) {
      if (this.runs.size >= MAX_TRACKED_RUNS) {
        const oldest = this.runs.keys().next().value;
        if (oldest !== undefined) this.runs.delete(oldest);
      }
      bucket = { orgId, events: [], listeners: new Set(), nextSeq: 0 };
      this.runs.set(runId, bucket);
    }
    return bucket;
  }
}
