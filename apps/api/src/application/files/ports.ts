/**
 * Ports for the file-browser use cases (F31). Defined here, implemented by `infrastructure`.
 *
 * ## The shape that matters: rows come back ALREADY FILTERED
 *
 * `listVisible` and `searchVisible` return only what the requester may see, because the
 * predicate that decides it is `wsx_visible_artifacts()` in SQL (migration 0018). The
 * application layer does NOT filter again.
 *
 * That is deliberate and it is the whole feature. A second, application-side filter would
 * make both "the SQL predicate is wrong" and "the SQL predicate was never applied"
 * undetectable -- the rows would be dropped anyway and every test would stay green. It would
 * also break the acceptance F31 is actually about: `listVisible` and `searchVisible` must
 * return THE SAME SET, and they can only be shown to do that if there is exactly one place
 * that decides.
 *
 * Rows still arrive as `Guarded<T>` and still leave through `permission-filter`. That is not
 * a second filter -- it is the one doorway (`lint-permission-paths`), and the decision it
 * consumes is the requester-level one the use case already made.
 */
import type { OrgId } from "../../domain/org-id";
import type { IngestionStatus } from "../../domain/files/ingestion-visibility";
import type { Guarded } from "../security/permission-filter";

/**
 * One row of the browser.
 *
 * ⚠ `sourceType` is `string`, not a union. XC-03 / `files.KNOWN_CONTRACT_GAPS.FS1`: three
 * source-type vocabularies exist in this repository and no two are equal. The contract keeps
 * it `z.string()` for that reason and so does this port. The looseness is a pending-ruling
 * marker, not a design.
 */
export interface ArtifactBrowserRow {
  readonly artifactId: string;
  readonly name: string;
  readonly sourceType: string;
  readonly agendaSegmentId: string | null;
  readonly sizeBytes: number;
  readonly confidential: boolean;
  readonly ingestionStatus: IngestionStatus;
  readonly updatedAt: string;
}

/** Filters, exactly the contract's set. Every field nullable = "not filtering on this". */
export interface ArtifactBrowserFilters {
  readonly sourceType: readonly string[];
  readonly agendaSegmentId: readonly string[];
  readonly timeRange: { readonly from: string; readonly to: string } | null;
  readonly uploader: { readonly type: "user" | "agent"; readonly id: string } | null;
  readonly confidential: boolean | null;
  readonly ingestionState: readonly IngestionStatus[];
}

export interface ListVisibleInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  /**
   * The requester's ORG team (`org_memberships.team_id`), or null.
   *
   * Passed in rather than looked up per row: it is one fact about the requester, and reading
   * it inside the row query would be the same lookup 5000 times.
   */
  readonly requesterTeamId: string | null;
  readonly filters: ArtifactBrowserFilters | null;
  readonly cursor: string | null;
  readonly pageSize: number;
}

export interface ArtifactBrowserRepository {
  /** The list/tree read. Already visibility-filtered, in SQL. */
  listVisible(input: ListVisibleInput): Promise<readonly Guarded<ArtifactBrowserRow>[]>;

  /**
   * The FTS read, through THE SAME `wsx_visible_artifacts()`.
   *
   * ⚠ Returns artifact rows, not segment hits, because F31's invariant is about the ARTIFACT
   * sets being equal. Snippets are `searchArtifacts`'s other half and are gated on T-6
   * (`files.KNOWN_CONTRACT_GAPS.FS4`, unruled) -- see the use case.
   */
  searchVisible(input: Omit<ListVisibleInput, "cursor"> & { readonly query: string }):
    Promise<readonly Guarded<ArtifactBrowserRow>[]>;

  /** Every row of the project the requester may see, unpaginated -- the tree's input. */
  treeRows(input: Omit<ListVisibleInput, "cursor" | "pageSize" | "filters">):
    Promise<readonly Guarded<Pick<ArtifactBrowserRow, "artifactId" | "sourceType" | "agendaSegmentId">>[]>;
}

/**
 * Is the object store reachable?
 *
 * A port rather than a direct call, because V7·22-1 is a behaviour: when object storage is
 * down the list still returns **200 with metadata** (metadata lives in PostgreSQL) and only
 * download/preview degrade. Making it injectable is what lets a test assert that without
 * taking the store down.
 */
export interface ObjectStoreProbe {
  available(): Promise<boolean>;
}

export const ARTIFACT_BROWSER_REPOSITORY = Symbol("ArtifactBrowserRepository");
export const OBJECT_STORE_PROBE = Symbol("ObjectStoreProbe");
