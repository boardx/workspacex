/**
 * PostgreSQL implementation of the context-pack bundle's persistence -- all three read shapes
 * and the write side, on ONE row (migration 0016).
 *
 * `ContextPackStore` (F13) + `ContextRunStore` (F12) + `ContextPackAuditStore` (F11) are three
 * questions about the same assembly, and they are answered by one class on purpose. Two
 * implementations would let the gate's answer and the audit's answer drift, and the shape of
 * that drift is unpleasant: the AI would be allowed to run on a pack the audit screen renders
 * differently.
 *
 * ⚠ **`pack()` and `findAudit()` go through `assembleFromRecorded`, not through a stored
 * document.** There is no stored document -- see the 0016 header. That is what makes the
 * citation check, the discard list and the replay all be about the same items[]: they are
 * literally the same computation.
 *
 * Every query runs through `withTenant`, so RLS is the first line and `org_id` the second.
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  ContextPackAuditStore,
  ContextPackStore,
  ContextRunStore,
  ModelConstraintPort,
  PinRecord,
  RecordedRunRow,
  StoredPackAudit,
} from "../../application/context-pack/ports";
import { assembleFromRecorded } from "../../application/context-pack/replay-pack";
import type { RunState } from "../../domain/context-pack/ai-gate";
import type { ContextPack } from "../../domain/context-pack/pack-structure";
import {
  packDataScope,
  selectableModels,
  type SelectableModel,
} from "../../domain/context-pack/model-routing";
import { assertRecordable, type RecordedRun } from "../../domain/context-pack/recorded-run";
import { toOrgId, type OrgId } from "../../domain/org-id";

interface RunRowShape {
  run_id: string;
  org_id: string;
  status: string;
  recorded: RecordedRun | null;
  content_hash: string | null;
  threshold_used: string | number | null;
  pinned_snapshot_id: string | null;
}

const SELECT_RUN = `SELECT run_id, org_id, status, recorded, content_hash, threshold_used, pinned_snapshot_id
                      FROM context_packs`;

/**
 * `double precision` comes back from `pg` as a JS number, but a `numeric` would come back as a
 * string and the column type is one migration away from being changed. Parsed rather than
 * cast, because `"0.45" >= 0.45` is `true` in JavaScript and a silently stringy threshold
 * would keep comparing correctly right up until it did not.
 */
function toNumber(v: string | number | null, what: string): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (n === null || !Number.isFinite(n)) throw new Error(`${what} is not a number: ${String(v)}`);
  return n;
}

export class PgContextPackStore implements ContextPackStore, ContextRunStore, ContextPackAuditStore {
  constructor(
    private readonly db: DatabasePort,
    /**
     * Which organization's rows this instance reads.
     *
     * The three read ports take only a `runId` -- they were written before there was a table
     * and none of them carries a tenant. Rather than widen three signed port shapes, the
     * tenant is bound at construction, which is also the honest description of the situation:
     * a request already knows its organization, and a store that let a caller pass an
     * arbitrary one would be inviting exactly the cross-tenant read RLS then refuses anyway.
     */
    private readonly orgId: OrgId,
    /** Identity's judgement, injected. This class must not contain one -- see `gateState`. */
    private readonly constraints: ModelConstraintPort,
    /**
     * Who is asking. A run is readable back only by the principal it was assembled FOR.
     *
     * ## Why this is here and not a `disclose()` call
     *
     * `lint-permission-paths` requires every tenant read to come back as `Guarded<T>`, and
     * this file is on its allowlist. The argument for the exemption is not "the filter was
     * inconvenient" -- it is that the decision the filter would attach is the WRONG decision:
     *
     *   * Re-authorizing each segment at replay time mints NEW `permissionDecisionId`s, so
     *     the replayed pack would cite judgements that did not exist when the conclusion was
     *     reached. I-11 asks an auditor to follow that id to the judgement that actually
     *     applied; a fresh one sends them to the wrong record.
     *   * A permission revoked since would make the historical pack SHRINK -- 上游变化改写了
     *     已固化的 Pack, which is I-7 broken by the very mechanism meant to protect it.
     *
     * Same shape as the provenance repository's exemption: an audit trail cannot be gated on
     * the answer it exists to supply. What replaces the per-segment decision is this coarser
     * one, enforced here and asserted in `context-pack-pinned-replay.test.ts`: the content in
     * `recorded` was already disclosed, under recorded decisions, to exactly one principal,
     * and only that principal can read it back.
     *
     * ⚠ **The auditor case is therefore NOT served**: V8 says 任取一条已定版结论 restore its
     * reference list, and a compliance officer who did not run the assembly cannot. That needs
     * an auditor role, which is `17-gov`'s and does not exist in phase-00 (coverage gap 5).
     * Refusing them is the safe half of a decision nobody has made; silently letting anyone in
     * the tenant read every run's contents would have been the other half, taken quietly.
     */
    private readonly requesterId: string,
  ) {}

  /* ── write side (F13) ─────────────────────────────────────────────────────────────── */

  async record(run: RecordedRun, contentHash: string): Promise<void> {
    // Checked before it reaches the database: a recording whose candidate ids overlap its
    // discarded ids can never be replayed, and the error would surface at audit time.
    assertRecordable(run);
    await this.db.withTenant(this.orgId, (s) =>
      s.query(
        `INSERT INTO context_packs (run_id, org_id, status, recorded, content_hash, threshold_used)
         VALUES ($1, $2, 'assembled', $3::jsonb, $4, $5)
         ON CONFLICT (run_id) DO UPDATE
           SET recorded = EXCLUDED.recorded,
               content_hash = EXCLUDED.content_hash,
               threshold_used = EXCLUDED.threshold_used,
               status = 'assembled'`,
        [run.runId, this.orgId, JSON.stringify(run), contentHash, run.thresholdUsed],
      ),
    );
    // ⚠ The UPDATE branch exists for A3 (调权重新装配 keeps the runId and produces a new packId)
    // and is refused by the trigger once the run is pinned. It is NOT a general "overwrite the
    // audit trail" path: 0016's `context_pack_pin_is_final` turns it into an error the moment
    // a decision depends on the row.
  }

  async recordFailure(input: { readonly runId: string; readonly orgId: OrgId }): Promise<void> {
    await this.db.withTenant(input.orgId, (s) =>
      s.query(
        `INSERT INTO context_packs (run_id, org_id, status)
         VALUES ($1, $2, 'retrieval-unavailable')
         ON CONFLICT (run_id) DO NOTHING`,
        [input.runId, input.orgId],
      ),
    );
    // DO NOTHING, not DO UPDATE: an outage must never overwrite a run that already assembled
    // successfully. That would turn a real pack into a block reason, and the pack would be
    // gone.
  }

  async findRecorded(runId: string): Promise<RecordedRunRow | null> {
    const row = await this.readRow(runId);
    if (row === null || row.status !== "assembled") return null;
    if (row.recorded === null || row.content_hash === null) {
      // Unreachable while `context_packs_assembled_iff_recorded` exists. Asserted rather than
      // `!`-ed, because the constraint is exactly the kind of thing a CREATE TABLE IF NOT
      // EXISTS no-op silently omits (see the 0016 reconciliation block).
      throw new Error(`run ${runId} is 'assembled' with no recording -- the CHECK constraint is missing`);
    }
    return {
      run: { ...row.recorded, thresholdUsed: toNumber(row.threshold_used, "threshold_used") },
      contentHash: row.content_hash,
      pinnedSnapshotId: row.pinned_snapshot_id,
    };
  }

  async findStatus(runId: string): Promise<"assembled" | "retrieval-unavailable" | null> {
    const row = await this.readRow(runId);
    return row === null ? null : (row.status as "assembled" | "retrieval-unavailable");
  }

  async pin(record: PinRecord): Promise<void> {
    const r = await this.db.withTenant(this.orgId, (s) =>
      s.query<{ run_id: string }>(
        `UPDATE context_packs
            SET pinned_snapshot_id = $2, pinned_at = now(), frozen_item_count = $3, content_hash = $4
          WHERE run_id = $1 AND status = 'assembled'
          RETURNING run_id`,
        [record.runId, record.snapshotId, record.frozenItemCount, record.contentHash],
      ),
    );
    if (r.rows.length === 0) {
      throw new Error(`no assembled run "${record.runId}" to pin`);
    }
    // A SECOND pin does not reach here: `context_pack_pin_is_final` raises on any UPDATE of an
    // already-pinned row, so the refusal is the database's rather than this method's. That
    // matters -- a check here would be bypassed by any other writer, and "the evidence behind
    // a decision was re-pointed" is not a bug anyone would notice from the outside.
  }

  async confidentialNow(orgId: OrgId, segmentIds: readonly string[]): Promise<ReadonlySet<string>> {
    if (segmentIds.length === 0) return new Set();
    const r = await this.db.withTenant(orgId, (s) =>
      s.query<{ segment_id: string }>(
        `SELECT segment_id FROM segment_text
          WHERE org_id = $1 AND segment_id = ANY($2::text[]) AND confidential`,
        [orgId, [...segmentIds]],
      ),
    );
    return new Set(r.rows.map((x) => x.segment_id));
  }

  async listModels(orgId: OrgId): Promise<readonly SelectableModel[]> {
    const r = await this.db.withTenant(orgId, (s) =>
      s.query<{ id: string; endpoint: string | null }>(
        `SELECT id, endpoint FROM capability_listings
          WHERE org_id = $1 AND kind = 'model' AND enabled
          ORDER BY id`,
        [orgId],
      ),
    );
    return r.rows.map((x) => ({ id: x.id, endpoint: x.endpoint }));
  }

  /* ── read side (F11 / F12), answered by REPLAYING ─────────────────────────────────── */

  async pack(runId: string): Promise<ContextPack | undefined> {
    const row = await this.findRecorded(runId);
    if (row === null) return undefined;
    return assembleFromRecorded(row.run, row.pinnedSnapshotId);
  }

  async gateState(runId: string): Promise<RunState | undefined> {
    const status = await this.findStatus(runId);
    if (status === null) return undefined;
    if (status === "retrieval-unavailable") return { kind: "retrieval-unavailable" };

    const row = await this.findRecorded(runId);
    if (row === null) return undefined;
    const assembled = assembleFromRecorded(row.run, row.pinnedSnapshotId);
    const orgId = toOrgId(row.run.orgId);

    // ⚠ `localOnly` is FETCHED, never decided here. F12's `RunState` says it "arrives as an
    // input" and coherence X-5 says why: a second judging point flattens 产品承诺 into
    // 组织策略, and only one of the two can be switched off. The union of recorded and current
    // confidentiality is the application's rule (`resolve-pack-model-constraint.ts`), so the
    // dataScope is built the same way here rather than a third way.
    const recorded = new Set(row.run.candidates.filter((c) => c.confidential).map((c) => c.segmentId));
    const now = await this.confidentialNow(orgId, assembled.items.map((i) => i.segmentId));
    const verdict = await this.constraints.resolve({
      userId: row.run.query.principalId,
      orgId,
      dataScope: packDataScope(assembled.items, new Set([...recorded, ...now])),
    });

    const models = await this.listModels(orgId);
    return {
      kind: "assembled",
      pack: assembled,
      localOnly: verdict.localOnly,
      // Asked of the CONFIGURED models rather than of a health probe: the gate's question is
      // "does this round have anywhere to run", and "is the runtime up right now" is a
      // different one that `getLocalRuntimeStatus` (F16) owns and answers with its own hint.
      localModelAvailable: selectableModels(models, verdict).length > 0,
    };
  }

  async findAudit(runId: string): Promise<StoredPackAudit | null> {
    const row = await this.findRecorded(runId);
    if (row === null) return null;
    const pack = assembleFromRecorded(row.run, row.pinnedSnapshotId);
    return {
      runId,
      orgId: toOrgId(row.run.orgId),
      items: pack.items,
      omissions: pack.omissions,
      // From the row, NOT from `relevanceThresholdFor(task)`. F11's port says why in full.
      thresholdUsed: row.run.thresholdUsed,
    };
  }

  private async readRow(runId: string): Promise<RunRowShape | null> {
    const r = await this.db.withTenant(this.orgId, (s) =>
      s.query<RunRowShape>(`${SELECT_RUN} WHERE run_id = $1 AND org_id = $2`, [runId, this.orgId]),
    );
    const row = r.rows[0];
    if (row === undefined) return null;
    // Another principal's run is reported as ABSENT, not as forbidden. A distinguishable
    // refusal makes this endpoint an oracle for run ids, and a run id is a handle on somebody
    // else's evidence -- the same rule `MANUAL_ITEM_UNAUTHORIZED` is given in `usecases.md`.
    if (row.recorded !== null && row.recorded.query.principalId !== this.requesterId) return null;
    return row;
  }
}
