/**
 * In-memory doubles for the F74 assignment ports (`assignment-ports.ts`).
 *
 * `FakeAssignmentStore` really keeps rows keyed by id and never deletes on revoke — it just
 * sets `revokedAt` — which is what lets the revocability test read back the same audit trail
 * production code would produce. `FakeBackfillConsumers` is the one piece that stands in for
 * "quotes / insights / report / graph": it counts references by calling `resolveSpeaker` over
 * a fixed set of consumer records, so a passing test proves the counts genuinely track the
 * live assignment table rather than a snapshot taken at consumer-creation time.
 */
import { resolveSpeaker, type AssignmentRecord, type RosterEntry } from "../../src/domain/recording/speaker-assignment";
import type {
  AssignmentStore,
  BackfillConsumers,
  ChannelInspector,
  IdGenerator,
  RosterProvider,
} from "../../src/application/recording/assignment-ports";

export class FakeRoster implements RosterProvider {
  private readonly bySession = new Map<string, readonly RosterEntry[]>();

  seed(sessionId: string, roster: readonly RosterEntry[]): void {
    this.bySession.set(sessionId, roster);
  }

  async rosterOf(sessionId: string): Promise<readonly RosterEntry[] | undefined> {
    return this.bySession.get(sessionId);
  }
}

export class FakeChannels implements ChannelInspector {
  private readonly overlap = new Map<string, boolean>();
  private readonly segmentCounts = new Map<string, number>();

  private key(sessionId: string, channelId: string): string {
    return `${sessionId}::${channelId}`;
  }

  setOverlap(sessionId: string, channelId: string, value: boolean): void {
    this.overlap.set(this.key(sessionId, channelId), value);
  }

  setSegmentCount(sessionId: string, channelId: string, count: number): void {
    this.segmentCounts.set(this.key(sessionId, channelId), count);
  }

  async hasUnresolvedOverlap(sessionId: string, channelId: string): Promise<boolean> {
    return this.overlap.get(this.key(sessionId, channelId)) ?? false;
  }

  async segmentCountFor(sessionId: string, channelId: string): Promise<number> {
    return this.segmentCounts.get(this.key(sessionId, channelId)) ?? 0;
  }
}

export class FakeAssignments implements AssignmentStore {
  readonly rows = new Map<string, AssignmentRecord>();

  async latestFor(sessionId: string, channelId: string): Promise<AssignmentRecord | undefined> {
    const rows = [...this.rows.values()].filter(
      (r) => r.sessionId === sessionId && r.channelId === channelId,
    );
    if (rows.length === 0) return undefined;
    // "Most recent" = highest channelVersion — a fresh fake per test, so ids don't reorder.
    return rows.reduce((a, b) => (b.channelVersion > a.channelVersion ? b : a));
  }

  async byId(assignmentId: string): Promise<AssignmentRecord | undefined> {
    return this.rows.get(assignmentId);
  }

  async create(record: AssignmentRecord): Promise<void> {
    this.rows.set(record.assignmentId, record);
  }

  async revoke(assignmentId: string, revokedAt: string): Promise<void> {
    const row = this.rows.get(assignmentId);
    if (row === undefined) throw new Error(`no assignment ${assignmentId}`);
    this.rows.set(assignmentId, { ...row, revokedAt });
  }
}

/**
 * One fake "reference" per consumer kind — a record that, when read, calls `resolveSpeaker`
 * itself rather than storing a `personId`. This is the counter-proof shape: if this fake
 * instead cached the resolved name at creation time, the revocability test would catch it,
 * because `countsReferencing` would keep counting a channel that no longer resolves.
 */
export class FakeBackfillConsumers implements BackfillConsumers {
  private readonly refs: { sessionId: string; channelId: string; kind: string }[] = [];

  /** Register that some consumer of kind `kind` points at this channel (a pointer, not a copy). */
  addRef(sessionId: string, channelId: string, kind: string): void {
    this.refs.push({ sessionId, channelId, kind });
  }

  async countsReferencing(sessionId: string, channelId: string): Promise<Readonly<Record<string, number>>> {
    const out: Record<string, number> = {};
    for (const ref of this.refs) {
      if (ref.sessionId !== sessionId || ref.channelId !== channelId) continue;
      out[ref.kind] = (out[ref.kind] ?? 0) + 1;
    }
    return out;
  }

  /** What a consumer would actually render right now — used by the test, not by the use case. */
  currentlyResolvedFor(sessionId: string, channelId: string, assignments: readonly AssignmentRecord[]): string | null {
    void sessionId;
    return resolveSpeaker(channelId, assignments);
  }
}

export class SequentialIds implements IdGenerator {
  private readonly counters = new Map<string, number>();

  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}-${n}`;
  }
}

export interface AssignmentHarness {
  readonly roster: FakeRoster;
  readonly channels: FakeChannels;
  readonly assignments: FakeAssignments;
  readonly backfill: FakeBackfillConsumers;
  readonly ids: SequentialIds;
}

export function assignmentHarness(): AssignmentHarness {
  return {
    roster: new FakeRoster(),
    channels: new FakeChannels(),
    assignments: new FakeAssignments(),
    backfill: new FakeBackfillConsumers(),
    ids: new SequentialIds(),
  };
}
