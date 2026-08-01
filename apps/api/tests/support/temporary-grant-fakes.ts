/**
 * Fakes for F05's (and now F127's) temporary-grant unit tests. Same reasoning as
 * `role-view-fakes.ts`: `grantTemporaryRead` / `checkTemporaryGrantAccess` are pure
 * application logic over ports, so the whole claim is testable in memory even though a real
 * `pg-temporary-grant-repository.ts` now exists (F127, `temporary_grants` table). This fake
 * mirrors that port 1:1, including `findActiveBySegment` and `markRevoked`'s boolean
 * "did this call actually revoke it" return -- both added for F127's push-revoke path in
 * `advanceAgendaSegment`.
 */
import type { OrgId } from "../../src/domain/org-id";
import type {
  AgendaSegmentStateForGrant,
  TemporaryGrant,
  TemporaryGrantRevokedReason,
  TemporaryGrantScope,
} from "../../src/domain/identity/temporary-grant";
import { grantCovers } from "../../src/domain/identity/temporary-grant";
import type {
  AgendaSegmentStateReader,
  CreateTemporaryGrantInput,
  TemporaryGrantRepository,
} from "../../src/application/identity/temporary-grant-ports";
import type {
  ProvenanceAppendInput,
  ProvenanceEventRecord,
  ProvenancePage,
  ProvenanceQuery,
  ProvenanceReader,
  ProvenanceWriter,
} from "../../src/application/provenance/ports";

export class FakeTemporaryGrantRepository implements TemporaryGrantRepository {
  readonly rows: TemporaryGrant[] = [];

  async create(input: CreateTemporaryGrantInput): Promise<TemporaryGrant> {
    const grant: TemporaryGrant = { ...input, revokedAt: null, revokedReason: null };
    this.rows.push(grant);
    return grant;
  }

  async findActive(orgId: OrgId, granteeId: string, scope: TemporaryGrantScope): Promise<TemporaryGrant | null> {
    return (
      this.rows.find(
        (g) => g.orgId === orgId && g.granteeId === granteeId && g.revokedAt === null && grantCovers(g, scope),
      ) ?? null
    );
  }

  async markRevoked(
    orgId: OrgId,
    id: string,
    revokedAt: string,
    reason: TemporaryGrantRevokedReason,
  ): Promise<boolean> {
    const i = this.rows.findIndex((g) => g.id === id && g.orgId === orgId);
    if (i === -1) return false;
    if (this.rows[i]!.revokedAt !== null) return false; // already revoked -- no-op, see port doc
    this.rows[i] = { ...this.rows[i]!, revokedAt, revokedReason: reason };
    return true;
  }

  async findActiveBySegment(
    orgId: OrgId,
    workshopId: string,
    agendaSegmentId: string,
  ): Promise<readonly TemporaryGrant[]> {
    return this.rows.filter(
      (g) =>
        g.orgId === orgId &&
        g.workshopId === workshopId &&
        g.agendaSegmentId === agendaSegmentId &&
        g.revokedAt === null,
    );
  }
}

/** Keyed by `${workshopId}:${agendaSegmentId}`, mutable so a test can simulate the segment
 *  advancing / being closed early / skipped / merged mid-test. */
export class FakeAgendaSegmentStateReader implements AgendaSegmentStateReader {
  constructor(private readonly states: Record<string, AgendaSegmentStateForGrant> = {}) {}

  setState(workshopId: string, agendaSegmentId: string, state: AgendaSegmentStateForGrant): void {
    this.states[`${workshopId}:${agendaSegmentId}`] = state;
  }

  async findState(_orgId: OrgId, workshopId: string, agendaSegmentId: string): Promise<AgendaSegmentStateForGrant | null> {
    return this.states[`${workshopId}:${agendaSegmentId}`] ?? null;
  }
}

/** Deterministic, advanceable clock -- tests assert "granted at t0, expired detection at t1"
 *  without depending on wall-clock time. */
export class FakeClock {
  constructor(private current = "2026-08-01T00:00:00.000Z") {}
  now(): string {
    return this.current;
  }
  set(iso: string): void {
    this.current = iso;
  }
}

/**
 * A single fake that is BOTH the writer `grantTemporaryRead`/`checkTemporaryGrantAccess`
 * append through and the reader `queryProvenance` reads back -- deliberately one object, not
 * a writer fake plus a separate reader fake, because F05's own acceptance criterion is
 * "授予与失效均写审计并可检索": a fake that could record writes a query can't see would let a
 * test pass while the real single-table design (`provenance.ts` file header: "ONE table, ONE
 * query surface") is what actually makes that true.
 */
export class FakeQueryableProvenance implements ProvenanceWriter, ProvenanceReader {
  private seq = 0;
  readonly events: ProvenanceEventRecord[] = [];

  constructor(private readonly clock: { now(): string } = new FakeClock()) {}

  async append(input: ProvenanceAppendInput): Promise<string> {
    this.seq += 1;
    const id = `ev-${this.seq}`;
    this.events.push({
      id,
      type: input.type,
      actorId: input.actorId,
      at: this.clock.now(),
      orgId: input.orgId,
      target: input.target,
      detail: input.detail,
    });
    return id;
  }

  async appendWithin(_session: unknown, input: ProvenanceAppendInput): Promise<string> {
    return this.append(input);
  }

  async query(orgId: OrgId, q: Omit<ProvenanceQuery, "orgId">): Promise<ProvenancePage> {
    const events = this.events.filter(
      (e) =>
        e.orgId === orgId &&
        (q.types === undefined || (q.types as readonly string[]).includes(e.type)) &&
        (q.actorId === undefined || e.actorId === q.actorId) &&
        (q.targetKind === undefined || e.target.kind === q.targetKind) &&
        (q.targetId === undefined || e.target.id === q.targetId),
    );
    return { events, nextCursor: null };
  }
}
