/**
 * Ports for three-mode bindings and the project-side backflow list (F06).
 *
 * Separate from `ports.ts` on purpose. That file owns the BYTES and the version lineage
 * (`ObjectStore` + `ArtifactRepository`); this one owns where a product is attached and in
 * what mode. Merging them would produce one repository interface whose implementer must be
 * given object storage in order to list a project's bindings.
 *
 * Every type here is `z.infer`red from the contract. A hand-written `interface Binding` would
 * be flagged by `lint-contract-source`, and it would deserve to be: the backend DTO shaped
 * like the contract is this project's highest-risk surface for one fact in two places.
 */
import { artifact as A } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { BindingModeName } from "../../domain/artifact/binding-modes";
import type { CitationAnchor } from "../../domain/artifact/downstream-eligibility";
import type { Guarded } from "../security/permission-filter";
import type { AuthorizeDeps } from "../identity/authorize";
import type { ProvenanceWriter } from "../provenance/ports";
import type { ArtifactRepository, IdFactory } from "./ports";

/**
 * What all three binding use cases need.
 *
 * `artifacts` is here because two of the three questions a binding asks are about versions
 * ("is there a head at all", "is that version this artifact's"), and those live on the
 * artifact repository. `auth` is the identity bundle's decision function: bindings are the
 * point where a product becomes visible to a project, so the two-layer check happens on the
 * way in, not as a filter afterwards.
 */
export interface BindingDeps {
  readonly bindings: BindingRepository;
  readonly artifacts: ArtifactRepository;
  readonly auth: AuthorizeDeps;
  readonly ids: IdFactory;
  /**
   * The audit trail (F08), and REQUIRED rather than optional.
   *
   * An optional writer is a writer that is absent wherever somebody forgot, and "did that
   * bind leave a trail" then depends on which call site you look at. Making it mandatory
   * means a new binding use case cannot be constructed without deciding what it records --
   * which is the whole of the overview's 5.1 (one collection point, no per-operation
   * instrumentation).
   */
  readonly provenance: ProvenanceWriter;
}

export type BindingRecord = z.infer<typeof A.Binding>;
export type BackflowEntryRecord = z.infer<typeof A.BackflowEntry>;

export interface NewBinding {
  readonly id: string;
  readonly orgId: OrgId;
  readonly artifactId: string;
  readonly projectId: string;
  readonly agendaSegmentId: string;
  readonly mode: BindingModeName;
  readonly pinnedVersionId: string | null;
  readonly createdBy: string;
}

/**
 * A stored binding, including the two columns `Binding` does not carry.
 *
 * `createdBy` is here and not in the contract: I-12 needs an author to compare a requester
 * against, and `Binding` has no such field. Reported as a contract finding -- the invariant
 * is stated in `domain.md` and is not expressible in the shape the API returns.
 */
export interface StoredBinding extends BindingRecord {
  readonly createdBy: string;
}

/**
 * One project-side row BEFORE the four required fields are resolved.
 *
 * Deliberately not `BackflowEntry`: for a `live` binding the version, its pinner and its
 * timestamp come from whatever the head is at read time, and for a `pinned` binding they
 * come from the frozen row. Returning the resolved shape straight from SQL would put that
 * difference -- which IS the feature -- inside a query, where the only way to assert it is
 * to assert the query.
 */
export interface BackflowRow {
  readonly bindingId: string;
  readonly artifactId: string;
  readonly title: string;
  readonly mode: BindingModeName;
  readonly pinnedVersionId: string | null;
  readonly createdBy: string;
  /**
   * The version this row resolves to right now: the pinned one, or the artifact's head.
   * Null when the artifact has no version at all -- which the use case must not turn into
   * a `BackflowEntry`, because `version` is `positive()` in the contract and there is no
   * honest number to put there.
   */
  readonly resolved: {
    readonly versionNumber: number;
    readonly pinnedBy: string;
    readonly pinnedAt: string;
  } | null;
}

/**
 * One place a withdrawn snapshot is cited from.
 *
 * `createdBy` is here because E5 says the people to notify are the ones whose decision the
 * citation supports, and the only such person this model knows about is whoever put the
 * citation there. Naming that limitation is better than calling the field `approverId` and
 * implying the model has decisions in it -- it does not; 拍板 belongs to 13-deliv.
 */
export interface ReferenceSite {
  readonly bindingId: string;
  readonly projectId: string;
  readonly agendaSegmentId: string;
  readonly createdBy: string;
}

export interface BindingRepository {
  create(b: NewBinding): Promise<void>;

  /** Null when absent, or when it belongs to another tenant -- RLS makes those the same. */
  findById(orgId: OrgId, bindingId: string): Promise<StoredBinding | null>;

  /** The at-most-one binding for a (artifact, project, step) triple. */
  findByStep(
    orgId: OrgId,
    artifactId: string,
    projectId: string,
    agendaSegmentId: string,
  ): Promise<StoredBinding | null>;

  /**
   * Raise a binding's mode. The database refuses anything that is not a raise (0008), so
   * this cannot be used to downgrade even by a caller that skipped the domain rule.
   */
  raiseMode(
    orgId: OrgId,
    bindingId: string,
    mode: BindingModeName,
    pinnedVersionId: string | null,
  ): Promise<void>;

  /** The id of version number `n` of an artifact; null when there is no such version. */
  findVersionIdByNumber(orgId: OrgId, artifactId: string, n: number): Promise<string | null>;

  /**
   * Every binding of this artifact, reduced to the two fields the citation rule reads (F07).
   *
   * The whole set, unfiltered. A4 lets one artifact be bound to several steps at several
   * versions, so "is THIS version pinned somewhere" is a question about the set -- and a
   * repository that answered it with `WHERE mode = 'pinned' AND pinned_version_id = $x`
   * would move the judgement into SQL, where the only way to assert it is to assert the
   * query. See `judgeCitation`.
   */
  findAnchorsForArtifact(orgId: OrgId, artifactId: string): Promise<readonly CitationAnchor[]>;

  /** Does this artifact exist in this tenant? Feeds `ARTIFACT_NOT_FOUND`. */
  artifactExists(orgId: OrgId, artifactId: string): Promise<boolean>;

  /**
   * The pinned bindings that CITE a given version -- E5's 「引用处」.
   *
   * `pinned` only, and that is the whole of I-14 restated from the other end: a `live`
   * binding does not cite a version, it resolves to whatever the head is now, so a
   * withdrawal has nothing to annotate there. Returning live bindings would annotate rows
   * that never rested on the withdrawn evidence.
   *
   * Returns ids and authors, no title -- so unlike `listForProject` it carries no content
   * and needs no `Guarded`. The authors are who E5 notifies.
   */
  listPinnedBindingsForVersion(
    orgId: OrgId,
    versionId: string,
  ): Promise<readonly ReferenceSite[]>;

  /**
   * The project-side rows, guarded.
   *
   * `Guarded<BackflowRow>` with `sources` naming the originating artifact, for the same
   * reason `findSegments` does it (I-13): a backflow row carries the artifact's TITLE, and a
   * title is content. A team-only artifact whose title is listed to the whole organization
   * is a smaller leak than its text and the same kind of leak.
   *
   * Drafts are RETURNED here and filtered by the use case. Filtering them in SQL would make
   * "no drafts were listed" and "the query matched nothing" the same observation.
   */
  listForProject(
    orgId: OrgId,
    projectId: string,
    agendaSegmentId?: string,
  ): Promise<readonly Guarded<BackflowRow>[]>;
}

export const BINDING_REPOSITORY = Symbol("BindingRepository");
