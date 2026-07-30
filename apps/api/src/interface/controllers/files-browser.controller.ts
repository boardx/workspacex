/**
 * The file browser's three read routes (F31). Protocol adaptation only -- every judgement
 * happens in `application`.
 *
 * ## Filters travel as one JSON query parameter, on purpose
 *
 * uc-22-1 R3 requires filters to be **composable and restorable from the URL** ("send a
 * colleague this view" is its acceptance form). A flat `?sourceType=a&sourceType=b&from=...`
 * spelling would need its own parser, and that parser would be a second definition of the
 * filter shape sitting next to the contract's. Instead `?filters=<json>` is handed straight to
 * `C.operations.listProjectArtifacts.in`, so the contract validates it -- the same schema the
 * frontend's types come from.
 *
 * ## Denials are 403 with a `reasonCode`, and 404 is never used to hide a project
 *
 * `NO_PROJECT_ROLE` is a member of `identity.PermissionReason`, so `AllExceptionsFilter`
 * passes it through the closed enum into the body. It is the ONLY denial reason this bundle's
 * reads emit: the use case collapses everything into it precisely so that "no such project"
 * and "not your project" are indistinguishable (N-25).
 */
import { Controller, ForbiddenException, Get, Inject, Param, Query } from "@nestjs/common";
import { files as C } from "@repo/contracts";
import {
  FilesReadDeniedError,
  getArtifactTree,
  listProjectArtifacts,
  searchArtifacts,
  type ArtifactTreeResult,
  type BrowseDeps,
  type ListArtifactsResult,
  type SearchArtifactsResult,
} from "../../application/files/browse-artifacts";
import {
  ARTIFACT_BROWSER_REPOSITORY,
  OBJECT_STORE_PROBE,
  type ArtifactBrowserRepository,
  type ObjectStoreProbe,
} from "../../application/files/ports";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../application/identity/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

export const LIST_ARTIFACTS_SCHEMA = C.operations.listProjectArtifacts.in;
export const ARTIFACT_TREE_SCHEMA = C.operations.getArtifactTree.in;
export const SEARCH_ARTIFACTS_SCHEMA = C.operations.searchArtifacts.in;

/** `?filters=` is JSON. A malformed value is a 400 from the contract parse, not a silent `{}`. */
function parseFilters(raw: string | undefined): unknown {
  if (raw === undefined || raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Returned as-is so the contract's own parse produces the error. Inventing a
    // BadRequestException here would make the message differ from every other malformed
    // input, for no gain.
    return raw;
  }
}

@Controller()
export class FilesBrowserController {
  constructor(
    @Inject(ARTIFACT_BROWSER_REPOSITORY) private readonly browser: ArtifactBrowserRepository,
    @Inject(OBJECT_STORE_PROBE) private readonly objectStore: ObjectStoreProbe,
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
  ) {}

  private get deps(): BrowseDeps {
    return { repo: this.repo, ids: this.ids, browser: this.browser, objectStore: this.objectStore };
  }

  @Get("/projects/:projectId/artifacts")
  async list(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Query("view") view: string | undefined,
    @Query("filters") filters: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("pageSize") pageSize: string | undefined,
  ): Promise<ListArtifactsResult> {
    assertPrincipal(principal);
    const input = LIST_ARTIFACTS_SCHEMA.parse({
      projectId,
      // `list` is the default view because the tree is a projection OF the list, not a
      // different dataset -- `getArtifactTree` reads the same rows.
      view: view ?? "list",
      filters: parseFilters(filters),
      cursor: cursor ?? null,
      pageSize: pageSize === undefined || pageSize === "" ? null : Number(pageSize),
    });
    return this.guardDenial(() =>
      listProjectArtifacts(this.deps, {
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        projectId: input.projectId,
        filters: input.filters,
        cursor: input.cursor,
        pageSize: input.pageSize,
      }),
    );
  }

  @Get("/projects/:projectId/artifact-tree")
  async tree(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
  ): Promise<ArtifactTreeResult> {
    assertPrincipal(principal);
    const input = ARTIFACT_TREE_SCHEMA.parse({ projectId });
    return this.guardDenial(() =>
      getArtifactTree(this.deps, {
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        projectId: input.projectId,
      }),
    );
  }

  @Get("/projects/:projectId/artifacts/search")
  async search(
    @CurrentPrincipal() principal: Principal,
    @Param("projectId") projectId: string,
    @Query("q") q: string | undefined,
  ): Promise<SearchArtifactsResult> {
    assertPrincipal(principal);
    const input = SEARCH_ARTIFACTS_SCHEMA.parse({ projectId, q: q ?? "" });
    return this.guardDenial(() =>
      searchArtifacts(this.deps, {
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        projectId: input.projectId,
        q: input.q,
      }),
    );
  }

  private async guardDenial<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      // The reason travels in the body, not in the status -- same rule as the identity
      // routes. There is exactly one reason here by design (see the header).
      if (e instanceof FilesReadDeniedError) throw new ForbiddenException({ reasonCode: e.reasonCode });
      throw e;
    }
  }
}
