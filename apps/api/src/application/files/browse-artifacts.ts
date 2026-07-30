/**
 * F31 -- the file browser's three read use cases: list, tree, search.
 *
 * ## The invariant this file exists to make true
 *
 * **可见集合 ≡ 检索可见集合.** What the list returns and what search can reach are the same
 * set of artifacts. Not "kept in sync" -- the same, because there is exactly ONE predicate
 * (`wsx_visible_artifacts()`, migration 0018) and both readers consult it.
 *
 * ## Two gates, and why only one of them is per-row
 *
 *   1. the REQUESTER gate, once per request: is this person a member of the organization, and
 *      does their project role permit reading at all? That is `decide()` (F01), reused, not
 *      re-implemented -- `authorize()` on the PROJECT object.
 *   2. the ROW gate, per artifact: visibility scope and owning team. That is SQL.
 *
 * Splitting them this way is what keeps the row gate single-sourced. Doing (2) in TypeScript
 * as well would put the scope rule in two languages, and the copy nobody reads is the one
 * that ends up wrong. (The one fact the two DO share -- the `org-wide` / `team-only` scope
 * test -- is driven through both by a differential test in `artifacts-list-rls.test.ts`.)
 *
 * ## Why a denial is `NO_PROJECT_ROLE` and never anything more specific
 *
 * The contract gives `listProjectArtifacts` exactly two failures: `NO_PROJECT_ROLE` and
 * `DEPENDENCY_UNAVAILABLE`. Every visibility denial collapses into the first, and a project
 * that does not exist produces the same answer as a project the requester may not read --
 * N-25: a rejection must not reveal whether the resource exists.
 */
import { files as C } from "@repo/contracts";
import type { z } from "zod";
import { buildArtifactTree, type TreeNodeOut } from "../../domain/files/artifact-tree";
import { originalDownloadable, retrievable } from "../../domain/files/ingestion-visibility";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import { discloseDecided, isDisclosed, type Disclosed, type Guarded } from "../security/permission-filter";
import type {
  ArtifactBrowserFilters,
  ArtifactBrowserRepository,
  ArtifactBrowserRow,
  ObjectStoreProbe,
} from "./ports";

export type ListArtifactsResult = z.infer<typeof C.operations.listProjectArtifacts.out>;
export type ArtifactTreeResult = z.infer<typeof C.operations.getArtifactTree.out>;
export type SearchArtifactsResult = z.infer<typeof C.operations.searchArtifacts.out>;

/**
 * The single failure this bundle's read paths raise.
 *
 * `reasonCode` is one of `files.FilesError`; `interface` maps it to a status. The application
 * layer does not know HTTP exists.
 */
export class FilesReadDeniedError extends Error {
  constructor(readonly reasonCode: "NO_PROJECT_ROLE") {
    super("files_read_denied");
  }
}

export interface BrowseDeps extends AuthorizeDeps {
  readonly browser: ArtifactBrowserRepository;
  readonly objectStore: ObjectStoreProbe;
}

export interface BrowseInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
}

/**
 * The action the browser is judged as.
 *
 * `read.allHands`, matching `read-content.ts`. Not `read.published`: picking the loosest read
 * surface here would silently widen the observer role, and nothing in the role matrix would
 * change to say so. An observer holds `read.published` only, so an observer is refused by
 * this gate -- which is the behaviour the denial screenshot shows.
 *
 * ⚠ Whether that is the RIGHT answer for an observer is `files.KNOWN_CONTRACT_GAPS.FS3`
 * (T-6, unruled): the prototype kept a download button structure with an un-wired gate, so
 * the UI reads as decided when it is not. This code takes the stricter branch (fail-closed);
 * it is not a ruling and must be revisited when T-6 lands.
 */
const BROWSE_ACTION = "read.allHands";

/** Default page size. Not a contract value -- the contract makes `pageSize` nullable. */
const DEFAULT_PAGE_SIZE = 100;

/**
 * Run the requester gate, and return the pieces the row gate needs.
 *
 * Throws on denial rather than returning an empty list: an empty list would be
 * indistinguishable from "this project has no files", and V5·22-1 requires the empty state to
 * be a real, recognisable state.
 */
async function passRequesterGate(
  deps: BrowseDeps,
  input: BrowseInput,
): Promise<{ decision: Awaited<ReturnType<typeof authorize>>; requesterTeamId: string | null }> {
  const { userId, orgId, projectId } = input;
  const [decision, membership] = await Promise.all([
    authorize(deps, { userId, orgId, projectId, object: { kind: "project", id: projectId }, action: BROWSE_ACTION }),
    deps.repo.findOrgMembership(userId, orgId),
  ]);
  if (!decision.allowed) throw new FilesReadDeniedError("NO_PROJECT_ROLE");
  return { decision, requesterTeamId: membership?.teamId ?? null };
}

/**
 * Unwrap rows the SQL predicate already cleared.
 *
 * `discloseDecided` with the requester-level decision, NOT `disclose()`. `disclose()` would
 * re-judge every row through `authorize`, which is the second filter this design exists to
 * avoid -- with it in place, deleting the SQL predicate would change nothing observable and
 * the counter-proof in `artifacts-list-rls.test.ts` could never go red.
 */
function unwrap<T>(items: readonly Guarded<T>[], decision: { allowed: boolean; decisionId: string }): T[] {
  const out: T[] = [];
  for (const g of items) {
    const r = discloseDecided(g, decision as Parameters<typeof discloseDecided>[1]);
    // Unreachable while `decision.allowed` is true (the gate above threw otherwise). Kept
    // because `discloseDecided` is a shared doorway and narrowing is what makes the payload
    // access below type-safe rather than asserted.
    if (isDisclosed(r)) out.push((r as Disclosed<T>).payload);
  }
  return out;
}

function toNode(row: ArtifactBrowserRow): ListArtifactsResult["nodes"][number] {
  return {
    artifactId: row.artifactId,
    name: row.name,
    sourceType: row.sourceType,
    agendaSegmentId: row.agendaSegmentId,
    sizeBytes: row.sizeBytes,
    confidential: row.confidential,
    ingestionStatus: row.ingestionStatus,
    // N-7: two independent booleans, derived in the domain from ONE table.
    originalDownloadable: originalDownloadable(row.ingestionStatus),
    retrievable: retrievable(row.ingestionStatus),
    updatedAt: row.updatedAt,
  };
}

export async function listProjectArtifacts(
  deps: BrowseDeps,
  input: BrowseInput & {
    readonly filters: ArtifactBrowserFilters | null;
    readonly cursor: string | null;
    readonly pageSize: number | null;
  },
): Promise<ListArtifactsResult> {
  const { decision, requesterTeamId } = await passRequesterGate(deps, input);
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;

  const guarded = await deps.browser.listVisible({
    orgId: input.orgId,
    projectId: input.projectId,
    requesterTeamId,
    filters: input.filters,
    cursor: input.cursor,
    // One extra row, so "is there a next page" is answered by data rather than by guessing
    // from `rows.length === pageSize` -- which is wrong exactly when the last page is full.
    pageSize: pageSize + 1,
  });
  const rows = unwrap(guarded, decision);
  const page = rows.slice(0, pageSize);
  const nextCursor = rows.length > pageSize ? (page[page.length - 1]?.artifactId ?? null) : null;

  /**
   * ⚠ Counts are over the RETURNED page's source types only.
   *
   * The contract asks for `sourceCounts` and `usecases.md` A5 asks for 「八类恒显示」 -- eight
   * nodes always present, even empty. That second half is NOT delivered, and deliberately:
   * see the header of `domain/files/artifact-tree.ts`. Emitting a fixed eight would be this
   * code casting XC-03 / FS1, in the least visible place available.
   *
   * What IS honoured is the half that does not depend on the ruling: no count is emitted for
   * anything the requester may not see. "已隐藏 N 项" is itself a leak, so there is no such
   * number anywhere in this response.
   */
  const counts = new Map<string, number>();
  for (const r of page) counts.set(r.sourceType, (counts.get(r.sourceType) ?? 0) + 1);

  return {
    nodes: page.map(toNode),
    sourceCounts: [...counts.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([sourceType, count]) => ({ sourceType, count })),
    cursor: nextCursor,
    // V7·22-1: still a 200 with metadata when the store is down; only download/preview degrade.
    downloadAvailable: await deps.objectStore.available(),
  };
}

export async function getArtifactTree(deps: BrowseDeps, input: BrowseInput): Promise<ArtifactTreeResult> {
  const { decision, requesterTeamId } = await passRequesterGate(deps, input);
  const guarded = await deps.browser.treeRows({
    orgId: input.orgId,
    projectId: input.projectId,
    requesterTeamId,
  });
  const rows = unwrap(guarded, decision);
  const tree: TreeNodeOut[] = buildArtifactTree(rows);
  return { tree };
}

export async function searchArtifacts(
  deps: BrowseDeps,
  input: BrowseInput & { readonly q: string },
): Promise<SearchArtifactsResult> {
  const { decision, requesterTeamId } = await passRequesterGate(deps, input);
  const guarded = await deps.browser.searchVisible({
    orgId: input.orgId,
    projectId: input.projectId,
    requesterTeamId,
    filters: null,
    pageSize: DEFAULT_PAGE_SIZE,
    query: input.q,
  });
  const rows = unwrap(guarded, decision);
  return {
    hits: rows.map((row) => ({
      node: toNode(row),
      /**
       * 🔴 Always null, and that is fail-closed, not unfinished.
       *
       * T-6 is unruled: whether a hit inside a CONFIDENTIAL file may show its text is
       * `files.KNOWN_CONTRACT_GAPS.FS4`. Showing snippets would take that text out from under
       * the "confidential material stays on the local model" routing rule (D-U1); the
       * contract's own note takes the closed branch. Emitting snippets for non-confidential
       * files only would be a third behaviour nobody signed, and it would leak by omission
       * (a hit with no snippet would mark the file as confidential).
       */
      snippet: null,
      /** Anchors belong to the segment channel; the artifact-level hit has none. */
      anchor: null,
    })),
  };
}
