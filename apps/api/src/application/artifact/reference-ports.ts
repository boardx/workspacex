/**
 * Port for `downstream_references` -- the table every citation of a snapshot goes through
 * (F07 / I-14 / coverage gap ③).
 *
 * Separate from `binding-ports.ts` because it is a different question: a binding says where
 * a product is attached and in what mode, a reference says who cited it and for what. The
 * five consumers of this port do not exist yet (context-pack / 13-deliv / 10-report / 09-kg
 * / 14-brain), which is exactly why the port is narrow -- it has to be the door they walk
 * through, not a repository they extend.
 *
 * There is `insertOrFind` and a read, and NO update and NO delete. That absence IS the
 * contract: `usecases.md` has no unreference operation, and E5 answers withdrawn evidence
 * with an annotation rather than a removal. A port that cannot express a mutation cannot
 * have an implementation that offers one. (Migration 0010 enforces the same thing from the
 * other side -- the runtime role holds SELECT and INSERT only.)
 */
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";
import type { DownstreamPurposeName } from "../../domain/artifact/downstream-eligibility";

export interface NewDownstreamReference {
  readonly id: string;
  readonly orgId: OrgId;
  readonly versionId: string;
  readonly purpose: DownstreamPurposeName;
  readonly referencedBy: { readonly kind: string; readonly id: string };
  readonly createdBy: string;
}

export interface StoredDownstreamReference {
  readonly id: string;
  readonly versionId: string;
  readonly purpose: DownstreamPurposeName;
  readonly referencedByKind: string;
  readonly referencedById: string;
}

export interface DownstreamReferenceRepository {
  /**
   * Record the citation, or return the one that is already there.
   *
   * Idempotent on `(purpose, referencedBy, versionId)` and on nothing wider: a claim cites
   * several pieces of evidence and a report section cites several products, so keying
   * without the version would forbid the ordinary case. `created` is returned so a caller
   * -- and a test -- can tell a retry from a first write; the operation's `out` cannot say
   * so, which is reported rather than papered over.
   */
  insertOrFind(ref: NewDownstreamReference): Promise<{ id: string; created: boolean }>;

  /**
   * Every citation of a version, guarded.
   *
   * `Guarded<T>` with `sources` naming the cited artifact, for the same reason
   * `listForProject` and `findSegments` do it (I-13). A citation row is not neutral
   * metadata: "this claim cites that snapshot" tells a reader that a team-only interview
   * exists and that a report they cannot open relies on it. That is the laundering UC-0.3 R7
   * describes, one level of indirection out.
   *
   * F08's `markEvidenceWithdrawn` is this method's second consumer -- it annotates exactly
   * these rows.
   */
  listForVersion(
    orgId: OrgId,
    versionId: string,
  ): Promise<readonly Guarded<StoredDownstreamReference>[]>;
}

export const DOWNSTREAM_REFERENCE_REPOSITORY = Symbol("DownstreamReferenceRepository");
