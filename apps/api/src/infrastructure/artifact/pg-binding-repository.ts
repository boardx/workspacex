/**
 * PostgreSQL implementation of `BindingRepository`.
 *
 * Every query runs through `withTenant`, so RLS is the first line and the `org_id` predicate
 * is the second.
 *
 * `listForProject` returns `Guarded<BackflowRow>` whose `sources` name the ORIGINATING
 * ARTIFACT, for the same reason `findSegments` does (I-13): a backflow row carries the
 * artifact's title, and a title is content. "You cannot open the team-only interview, but
 * the project list tells you it exists and what it is called" is a smaller version of the
 * laundering UC-0.3 R7 describes, and it is the version nobody notices.
 *
 * The id-level lookups (`findById`, `findByStep`, `artifactExists`,
 * `findVersionIdByNumber`) return plain values rather than `Guarded<T>` on purpose: they
 * carry no content, and what they feed is the DECISION -- the two-layer check in
 * `bindToProjectStep` / `upgradeBinding`. Guarding the inputs to a decision with that same
 * decision is the circularity the identity repository's allowlist entry describes. Nothing
 * they return reaches a response body; only `listForProject`'s payload does, and that one is
 * guarded.
 */
import type { DatabasePort } from "../../application/ports/database.port";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type {
  BackflowRow,
  BindingRepository,
  NewBinding,
  ReferenceSite,
  StoredBinding,
} from "../../application/artifact/binding-ports";
import type { BindingModeName } from "../../domain/artifact/binding-modes";
import type { CitationAnchor } from "../../domain/artifact/downstream-eligibility";
import type { OrgId } from "../../domain/org-id";

interface BindingRowShape {
  id: string;
  artifact_id: string;
  project_id: string;
  agenda_segment_id: string;
  mode: string;
  pinned_version_id: string | null;
  created_by: string;
}

const toStored = (r: BindingRowShape): StoredBinding => ({
  id: r.id,
  artifactId: r.artifact_id,
  projectId: r.project_id,
  agendaSegmentId: r.agenda_segment_id,
  mode: r.mode as BindingModeName,
  pinnedVersionId: r.pinned_version_id,
  createdBy: r.created_by,
});

const SELECT_BINDING = `SELECT id, artifact_id, project_id, agenda_segment_id, mode, pinned_version_id, created_by
                          FROM artifact_bindings`;

export class PgBindingRepository implements BindingRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(b: NewBinding): Promise<void> {
    await this.db.withTenant(b.orgId, (s) =>
      s.query(
        `INSERT INTO artifact_bindings
           (id, org_id, artifact_id, project_id, agenda_segment_id, mode, pinned_version_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [b.id, b.orgId, b.artifactId, b.projectId, b.agendaSegmentId, b.mode, b.pinnedVersionId, b.createdBy],
      ),
    );
    // No ON CONFLICT. A duplicate (artifact, project, step) means somebody else bound the
    // same product to the same step concurrently, and DO NOTHING would report success for a
    // write that did not happen -- handing back a binding id that names another writer's row,
    // possibly in another mode.
  }

  async findById(orgId: OrgId, bindingId: string): Promise<StoredBinding | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<BindingRowShape>(`${SELECT_BINDING} WHERE org_id = $1 AND id = $2`, [
        orgId,
        bindingId,
      ]);
      return r.rows[0] ? toStored(r.rows[0]) : null;
    });
  }

  async findByStep(
    orgId: OrgId,
    artifactId: string,
    projectId: string,
    agendaSegmentId: string,
  ): Promise<StoredBinding | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<BindingRowShape>(
        `${SELECT_BINDING}
          WHERE org_id = $1 AND artifact_id = $2 AND project_id = $3 AND agenda_segment_id = $4`,
        [orgId, artifactId, projectId, agendaSegmentId],
      );
      return r.rows[0] ? toStored(r.rows[0]) : null;
    });
  }

  async raiseMode(
    orgId: OrgId,
    bindingId: string,
    mode: BindingModeName,
    pinnedVersionId: string | null,
  ): Promise<void> {
    await this.db.withTenant(orgId, (s) =>
      // Only `mode` and `pinned_version_id` are in the SET list. The identity columns are
      // not settable from here at all, which is a second lock on top of 0008's trigger --
      // the trigger stops a hand-written UPDATE, this stops a future edit to this method.
      s.query(
        `UPDATE artifact_bindings SET mode = $3, pinned_version_id = $4
          WHERE org_id = $1 AND id = $2`,
        [orgId, bindingId, mode, pinnedVersionId],
      ),
    );
  }

  async findVersionIdByNumber(orgId: OrgId, artifactId: string, n: number): Promise<string | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ id: string }>(
        `SELECT id FROM artifact_versions
          WHERE org_id = $1 AND artifact_id = $2 AND version_number = $3`,
        [orgId, artifactId, n],
      );
      return r.rows[0]?.id ?? null;
    });
  }

  async findAnchorsForArtifact(
    orgId: OrgId,
    artifactId: string,
  ): Promise<readonly CitationAnchor[]> {
    return this.db.withTenant(orgId, async (s) => {
      // No `WHERE mode = 'pinned'`: the citation rule is a predicate over the whole set
      // (`judgeCitation`), and it is kept there so it is asserted directly rather than
      // through a query.
      //
      // ⚠ MEASURED, not assumed: adding `AND mode = 'pinned'` here changes NO test outcome
      // (all 29 stay green), because `judgeCitation` still compares the version id. So this
      // is a testability preference, not a correctness one, and saying otherwise would be
      // the over-claim this project keeps catching. What IS load-bearing is returning the
      // rows at all -- emptying this list turns ten assertions red.
      const r = await s.query<{ mode: string; pinned_version_id: string | null }>(
        `SELECT mode, pinned_version_id FROM artifact_bindings
          WHERE org_id = $1 AND artifact_id = $2`,
        [orgId, artifactId],
      );
      return r.rows.map((row) => ({
        mode: row.mode as BindingModeName,
        pinnedVersionId: row.pinned_version_id,
      }));
    });
  }

  async artifactExists(orgId: OrgId, artifactId: string): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ id: string }>(
        `SELECT id FROM artifacts WHERE org_id = $1 AND id = $2`,
        [orgId, artifactId],
      );
      return r.rows.length > 0;
    });
  }

  /**
   * E5's reference sites. `mode = 'pinned'` is in the WHERE and not left to the caller: a
   * live binding does not cite this version, it resolves to the head, and annotating it
   * would mark a citation that never rested on the withdrawn bytes.
   *
   * Ordered by id so `annotatedReferences` is stable -- an unordered list is one a caller
   * cannot compare, and comparing it is exactly what a withdrawal review does.
   */
  async listPinnedBindingsForVersion(
    orgId: OrgId,
    versionId: string,
  ): Promise<readonly ReferenceSite[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        id: string;
        project_id: string;
        agenda_segment_id: string;
        created_by: string;
      }>(
        `SELECT id, project_id, agenda_segment_id, created_by
           FROM artifact_bindings
          WHERE org_id = $1 AND pinned_version_id = $2 AND mode = 'pinned'
          ORDER BY id`,
        [orgId, versionId],
      );
      return r.rows.map((row) => ({
        bindingId: row.id,
        projectId: row.project_id,
        agendaSegmentId: row.agenda_segment_id,
        createdBy: row.created_by,
      }));
    });
  }

  async listForProject(
    orgId: OrgId,
    projectId: string,
    agendaSegmentId?: string,
  ): Promise<readonly Guarded<BackflowRow>[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        id: string;
        artifact_id: string;
        title: string;
        mode: string;
        pinned_version_id: string | null;
        created_by: string;
        version_number: number | null;
        pinned_by: string | null;
        pinned_at: Date | null;
      }>(
        // ONE query, one LATERAL per row. The alternative -- list the bindings, then fetch a
        // version for each -- makes the number of round trips proportional to the project's
        // history, and R9 requires this list to page.
        //
        // The LATERAL is the whole mode difference, written once:
        //   pinned  join the named version. Fixed. The source moving cannot reach it (I-8).
        //   live    take the artifact's highest version AT READ TIME. It moves, on purpose.
        //   draft   also resolved -- and then dropped by the use case, not by this WHERE
        //           clause, so "no drafts" stays distinguishable from "no rows".
        `SELECT b.id, b.artifact_id, a.title, b.mode, b.pinned_version_id, b.created_by,
                v.version_number, v.pinned_by, v.pinned_at
           FROM artifact_bindings b
           JOIN artifacts a ON a.id = b.artifact_id AND a.org_id = b.org_id
           LEFT JOIN LATERAL (
             SELECT av.version_number, av.pinned_by, av.pinned_at
               FROM artifact_versions av
              WHERE av.org_id = b.org_id
                AND av.artifact_id = b.artifact_id
                AND (b.pinned_version_id IS NULL OR av.id = b.pinned_version_id)
              ORDER BY av.version_number DESC
              LIMIT 1
           ) v ON true
          WHERE b.org_id = $1 AND b.project_id = $2 AND ($3::text IS NULL OR b.agenda_segment_id = $3)
          ORDER BY b.created_at, b.id`,
        [orgId, projectId, agendaSegmentId ?? null],
      );

      return r.rows.map((row) => {
        const payload: BackflowRow = {
          bindingId: row.id,
          artifactId: row.artifact_id,
          title: row.title,
          mode: row.mode as BindingModeName,
          pinnedVersionId: row.pinned_version_id,
          createdBy: row.created_by,
          resolved:
            row.version_number === null || row.pinned_by === null || row.pinned_at === null
              ? null
              : {
                  versionNumber: row.version_number,
                  pinnedBy: row.pinned_by,
                  // ISO, once, here. A `Date` crossing into a response body serialises
                  // differently depending on who does it, and `pinnedAt` is a contract string.
                  pinnedAt: row.pinned_at.toISOString(),
                },
        };
        // ⚠ `ref` and `sources` are the SAME object here, and that is a gap, not a choice.
        //
        // A backflow row is derived: it exists because a binding points at an artifact, and
        // I-13 says its effective visibility is the ORIGINAL's, only ever narrower. Saying so
        // properly means `ref` = the binding and `sources` = [the artifact]. But `ObjectRef`
        // is a closed three-member enum -- `project | artifact | segment` -- with no member
        // for a binding, in the contract AND in `acl_bindings.object_kind`. There is no way
        // to name this row as itself.
        //
        // So it is named as its artifact, which yields the RIGHT verdict (one source, so the
        // strictest scope is that source's) by collapsing the derivation rather than
        // traversing it. The consequence is measured, not assumed: emptying `sources` here
        // changes no test outcome, because `ref` is judged directly and gives the same
        // answer. That is recorded in `backflow-list-fields.test.ts` as a gap assertion
        // instead of being presented as I-13 coverage.
        return guard<BackflowRow>({ kind: "artifact", id: row.artifact_id }, payload, [
          { kind: "artifact", id: row.artifact_id },
        ]);
      });
    });
  }
}
