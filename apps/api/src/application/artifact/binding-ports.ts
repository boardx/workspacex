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
import type { Guarded } from "../security/permission-filter";
import type { AuthorizeDeps } from "../identity/authorize";
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
}

export type BindingRecord = z.infer<typeof A.Binding>;
export type BackflowEntryRecord = z.infer<typeof A.BackflowEntry>;

export interface NewBinding {
  readonly id: string;
  readonly orgId: OrgId;
  readonly artifactId: string;
  readonly projectId: string;
  readonly stepId: string;
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

export interface BindingRepository {
  create(b: NewBinding): Promise<void>;

  /** Null when absent, or when it belongs to another tenant -- RLS makes those the same. */
  findById(orgId: OrgId, bindingId: string): Promise<StoredBinding | null>;

  /** The at-most-one binding for a (artifact, project, step) triple. */
  findByStep(
    orgId: OrgId,
    artifactId: string,
    projectId: string,
    stepId: string,
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

  /** Does this artifact exist in this tenant? Feeds `ARTIFACT_NOT_FOUND`. */
  artifactExists(orgId: OrgId, artifactId: string): Promise<boolean>;

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
    stepId?: string,
  ): Promise<readonly Guarded<BackflowRow>[]>;
}

export const BINDING_REPOSITORY = Symbol("BindingRepository");
