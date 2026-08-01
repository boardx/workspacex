/**
 * Fakes for F40's materialization-event-bus unit tests. Same reasoning as
 * `temporary-grant-fakes.ts`: the bus and the queue port are pure application logic with no
 * durable Postgres store yet (the store is each per-source materializer feature's own later
 * infra work), so the whole claim is testable in memory.
 */
import type { OrgId } from "../../src/domain/org-id";
import type { Clock } from "../../src/application/auth/ports";
import type { IdFactory } from "../../src/application/artifact/ports";
import {
  MATERIALIZATION_PRIORITY_RANK,
  type MaterializationPriority,
} from "../../src/domain/files/materialization-events";
import type {
  BacklogAlertPort,
  MaterializationJob,
  MaterializationQueueRepository,
  NewMaterializationJob,
} from "../../src/application/files/materialize-ports";

/** Deterministic, advanceable clock -- same shape as `FakeClock` in `temporary-grant-fakes.ts`,
 *  but returning `Date` since that is what `application/auth/ports.ts`'s `Clock` port declares. */
export class FakeClock implements Clock {
  private currentMs: number;
  constructor(startIso = "2026-08-01T00:00:00.000Z") {
    this.currentMs = new Date(startIso).getTime();
  }
  now(): Date {
    return new Date(this.currentMs);
  }
  /** Advance by N milliseconds -- how tests fast-forward a 5-minute debounce window without
   *  a real 5-minute wait. */
  advance(ms: number): void {
    this.currentMs += ms;
  }
}

export class SeqIds implements IdFactory {
  private n = 0;
  constructor(private readonly prefix = "f40") {}
  next(p: string): string {
    this.n += 1;
    return `${this.prefix}-${p}-${this.n}`;
  }
}

/**
 * In-memory shared queue. `claimNext` sorts by `MATERIALIZATION_PRIORITY_RANK` first
 * (upload before materialization), `enqueuedAt` second (FIFO within the same priority) --
 * this is the SAME ordering rule the production adapter must implement, restated here as
 * data rather than duplicated logic, so a drift between the two would be a copy-paste bug
 * in the production adapter, not two independently-invented orderings.
 */
export class FakeMaterializationQueue implements MaterializationQueueRepository {
  private seq = 0;
  /** Pending jobs, per org. Claimed jobs are removed -- this fake models "pending count",
   *  not full job history; tests that need history read `enqueuedLog` instead. */
  private readonly pending = new Map<OrgId, MaterializationJob[]>();
  /** Every job ever enqueued, in enqueue order, regardless of org or claim state -- the
   *  "nothing was dropped" assertion point (E5). */
  readonly enqueuedLog: MaterializationJob[] = [];

  async enqueue(job: NewMaterializationJob): Promise<void> {
    this.seq += 1;
    const full: MaterializationJob = { ...job };
    const list = this.pending.get(job.orgId) ?? [];
    list.push(full);
    this.pending.set(job.orgId, list);
    this.enqueuedLog.push(full);
  }

  async pendingCount(orgId: OrgId): Promise<number> {
    return (this.pending.get(orgId) ?? []).length;
  }

  async claimNext(orgId: OrgId): Promise<MaterializationJob | null> {
    const list = this.pending.get(orgId) ?? [];
    if (list.length === 0) return null;
    const sorted = [...list].sort((a, b) => {
      const rankDiff = MATERIALIZATION_PRIORITY_RANK[a.priority] - MATERIALIZATION_PRIORITY_RANK[b.priority];
      if (rankDiff !== 0) return rankDiff;
      return a.enqueuedAt.getTime() - b.enqueuedAt.getTime();
    });
    const claimed = sorted[0]!;
    this.pending.set(
      orgId,
      list.filter((j) => j.id !== claimed.id),
    );
    return claimed;
  }

  /** Test helper: simulate an upload-priority job landing in the SAME shared queue, the way
   *  F35's upload path would (out of this feature's scope to actually wire, but the fake
   *  lets a test prove the priority ordering holds regardless of who is enqueuing). */
  async enqueueUpload(orgId: OrgId, sourceRef: string, enqueuedAt: Date, priority: MaterializationPriority = "upload"): Promise<void> {
    await this.enqueue({
      id: `upload-${sourceRef}`,
      orgId,
      sourceType: "conversation",
      sourceRef,
      agendaSegmentId: null,
      priority,
      enqueuedAt,
    });
  }
}

export class FakeBacklogAlerter implements BacklogAlertPort {
  readonly raised: { orgId: OrgId; pendingCount: number; threshold: number }[] = [];
  async raise(input: { orgId: OrgId; pendingCount: number; threshold: number }): Promise<void> {
    this.raised.push(input);
  }
}
