/**
 * F74 — the ports `assignChannel` / `revokeAssignment` need.
 *
 * ⚠ Ships **no PostgreSQL implementation**, same call F69 made for the segments/tracks
 * tables: the `sessions` / `channels` tables this port set assumes are shaped by F69/F70/F71,
 * which have not created them yet (see `capture.ts` top comment). What this feature owns is
 * the shape of the questions assignment asks, plus the domain rules in
 * `domain/recording/speaker-assignment.ts`; `tests/support/rec-fakes.ts` gets the in-memory
 * doubles this file's use cases run against.
 *
 * `BackfillTarget` is deliberately a **count port**, not a content port: `assignChannel` /
 * `revokeAssignment` only ever learn "how many rows of which kind changed", never their
 * content (I-10 / I-11 — backfill is a pointer, not a copy, so there is nothing to fetch).
 */
import type { AssignmentRecord, RosterEntry } from "../../domain/recording/speaker-assignment";

export interface RosterProvider {
  /** `undefined` ⇒ `ROSTER_UNAVAILABLE` — must NOT fall back to any cross-session source (I-12). */
  rosterOf(sessionId: string): Promise<readonly RosterEntry[] | undefined>;
}

export interface ChannelInspector {
  /** True while the channel still has at least one unresolved (unsplit) overlap segment. */
  hasUnresolvedOverlap(sessionId: string, channelId: string): Promise<boolean>;
  /** How many segments this channel covers — `assignChannel`'s `affectedSegmentCount`. */
  segmentCountFor(sessionId: string, channelId: string): Promise<number>;
}

export interface AssignmentStore {
  /**
   * The most recent assignment row for a channel, active or revoked. This is what optimistic
   * concurrency (`expectedChannelVersion`) checks against — the version number tracks "how
   * many times this channel has been written", not "is it currently active", so a channel
   * that was assigned and then revoked keeps counting up from where it left off.
   */
  latestFor(sessionId: string, channelId: string): Promise<AssignmentRecord | undefined>;
  byId(assignmentId: string): Promise<AssignmentRecord | undefined>;
  /** Persists a brand-new assignment row. Revoking never deletes a row — see `revoke`. */
  create(record: AssignmentRecord): Promise<void>;
  /** Sets `revokedAt`; the row and its history stay for audit (uc-5-2 R7 收口). */
  revoke(assignmentId: string, revokedAt: string): Promise<void>;
}

/**
 * The consumers that hold a *reference* to a channel's resolved speaker, not a copy of the
 * name (quotes / insight badges / report citations / graph nodes). `affectedCounts` and
 * `revertedCounts` report **how many pointers exist per kind**, which is all `assignChannel`
 * output (`backfilledRefs`) / `revokeAssignment` output (`revertedRefs`) needs — there is
 * nothing to "go rewrite" because nothing was ever copied.
 */
export interface BackfillConsumers {
  /** `{ quote: 3, insight: 1, report: 0, graph: 2 }`-shaped counts, keyed by consumer kind. */
  countsReferencing(sessionId: string, channelId: string): Promise<Readonly<Record<string, number>>>;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export type { AssignmentRecord, RosterEntry };
