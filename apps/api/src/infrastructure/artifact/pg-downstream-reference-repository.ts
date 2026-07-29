/**
 * PostgreSQL implementation of `DownstreamReferenceRepository` (F07).
 *
 * Every query runs through `withTenant`, so RLS is the first line and the `org_id` predicate
 * is the second.
 *
 * Nothing here decides eligibility. The BEFORE INSERT trigger in 0010 does, and this class
 * does not catch or translate its refusal: a repository that turned a trigger's exception
 * into a friendly domain error would be the place where "the database refused" quietly
 * becomes "the application declined", and the two have very different implications for a
 * consumer that skipped the use case. The application makes the same judgement BEFORE
 * getting here, so the trigger firing means a caller reached the table another way.
 */
import type { DatabasePort } from "../../application/ports/database.port";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type {
  DownstreamReferenceRepository,
  NewDownstreamReference,
  StoredDownstreamReference,
} from "../../application/artifact/reference-ports";
import type { DownstreamPurposeName } from "../../domain/artifact/downstream-eligibility";
import type { OrgId } from "../../domain/org-id";

interface ReferenceRowShape {
  id: string;
  version_id: string;
  purpose: string;
  referenced_by_kind: string;
  referenced_by_id: string;
}

const toStored = (r: ReferenceRowShape): StoredDownstreamReference => ({
  id: r.id,
  versionId: r.version_id,
  purpose: r.purpose as DownstreamPurposeName,
  referencedByKind: r.referenced_by_kind,
  referencedById: r.referenced_by_id,
});

const SELECT_REFERENCE_WITH_ARTIFACT =
  `SELECT r.id, r.version_id, r.purpose, r.referenced_by_kind, r.referenced_by_id, v.artifact_id
     FROM downstream_references r
     JOIN artifact_versions v ON v.id = r.version_id AND v.org_id = r.org_id`;

export class PgDownstreamReferenceRepository implements DownstreamReferenceRepository {
  constructor(private readonly db: DatabasePort) {}

  async insertOrFind(ref: NewDownstreamReference): Promise<{ id: string; created: boolean }> {
    return this.db.withTenant(ref.orgId, async (s) => {
      // ON CONFLICT DO NOTHING, deliberately, and this is the one place in the artifact code
      // where it is right. F06's `create` refuses it because a duplicate binding means
      // another writer took the step and reporting success would hand back a row that is not
      // yours. Here the conflicting row is BY DEFINITION the same citation -- same citer,
      // same purpose, same snapshot -- so returning it is what a retried POST should get.
      //
      // The eligibility trigger runs BEFORE conflict resolution, so a second attempt at an
      // ineligible version is still refused rather than silently absorbed.
      const inserted = await s.query<{ id: string }>(
        `INSERT INTO downstream_references
           (id, org_id, version_id, purpose, referenced_by_kind, referenced_by_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT ON CONSTRAINT downstream_references_uniq DO NOTHING
         RETURNING id`,
        [
          ref.id, ref.orgId, ref.versionId, ref.purpose,
          ref.referencedBy.kind, ref.referencedBy.id, ref.createdBy,
        ],
      );
      if (inserted.rows[0]) return { id: inserted.rows[0].id, created: true };

      const existing = await s.query<{ id: string }>(
        `SELECT id FROM downstream_references
          WHERE org_id = $1 AND purpose = $2 AND referenced_by_kind = $3
            AND referenced_by_id = $4 AND version_id = $5`,
        [ref.orgId, ref.purpose, ref.referencedBy.kind, ref.referencedBy.id, ref.versionId],
      );
      const found = existing.rows[0];
      if (!found) {
        // Neither inserted nor found: the conflict was on some other constraint, or the row
        // vanished between the two statements. Both are faults, and reporting a fabricated
        // id would hand the caller a reference to nothing.
        throw new Error("downstream reference was neither inserted nor found");
      }
      return { id: found.id, created: false };
    });
  }

  async listForVersion(
    orgId: OrgId,
    versionId: string,
  ): Promise<readonly Guarded<StoredDownstreamReference>[]> {
    return this.db.withTenant(orgId, async (s) => {
      // The join is what makes the guard possible: a citation row names a VERSION, and
      // `ObjectRef` has no member for one -- it is `project | artifact | segment | capability`
      // in the contract and in `acl_bindings.object_kind`. So the row is named as the
      // artifact it cites, which is also where its scope comes from (I-13).
      //
      // ⚠ `ref` and `sources` are the SAME object, and that is a gap, not a choice -- the
      // identical one `listForProject` records. MEASURED, not assumed: emptying `sources`
      // here changes NO test outcome (all 29 stay green), because `ref` is judged directly
      // and gives the same answer. So this is NOT I-13 coverage for citations; it is the
      // derivation collapsed to one hop. A citation whose scope must differ from its
      // artifact's has nowhere to say so.
      const r = await s.query<ReferenceRowShape & { artifact_id: string }>(
        `${SELECT_REFERENCE_WITH_ARTIFACT}
          WHERE r.org_id = $1 AND r.version_id = $2 ORDER BY r.created_at, r.id`,
        [orgId, versionId],
      );
      return r.rows.map((row) =>
        guard<StoredDownstreamReference>({ kind: "artifact", id: row.artifact_id }, toStored(row), [
          { kind: "artifact", id: row.artifact_id },
        ]),
      );
    });
  }
}
