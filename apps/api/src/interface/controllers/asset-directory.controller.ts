/**
 * F141's two read routes (`GetAssetDirectory` / `ReadAssetFile`). Protocol adaptation only --
 * see `application/asset/*` for the judgement.
 *
 * ⚠ **Denial is a bare 404, not a 403 with a reason.** Both "you are not a member of this
 * organization" and "no such asset" collapse into `NotFoundException()` with no body --
 * following `skills` I-14 (reused by this bundle's `AssetGovernanceError`, see the contract's
 * comment on why there is no separate `ASSET_NOT_FOUND` code). A distinguishable 403 would
 * let a non-member learn that *something* exists at that id even if they cannot read it.
 */
import { Controller, Get, Inject, NotFoundException, Param, Query } from "@nestjs/common";
import { assetGovernance as C } from "@repo/contracts";
import {
  AssetNotFoundError,
  AssetOrgScopeDeniedError,
  getAssetDirectory,
  type GetAssetDirectoryResult,
} from "../../application/asset/get-asset-directory";
import { readAssetFile, type ReadAssetFileResult } from "../../application/asset/read-asset-file";
import { ASSET_FILE_REPOSITORY, type AssetFileRepository } from "../../application/asset/ports";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

export const GET_ASSET_DIRECTORY_SCHEMA = C.operations.getAssetDirectory.in;
export const READ_ASSET_FILE_SCHEMA = C.operations.readAssetFile.in;

@Controller()
export class AssetDirectoryController {
  constructor(
    @Inject(ASSET_FILE_REPOSITORY) private readonly assets: AssetFileRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
  ) {}

  @Get("/assets/:assetKind/:assetId/files")
  async directory(
    @CurrentPrincipal() principal: Principal,
    @Param("assetKind") assetKind: string,
    @Param("assetId") assetId: string,
  ): Promise<GetAssetDirectoryResult> {
    assertPrincipal(principal);
    const input = GET_ASSET_DIRECTORY_SCHEMA.parse({ assetKind, assetId });
    return this.guardDenial(() =>
      getAssetDirectory(
        { repo: this.repo, assets: this.assets },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          assetKind: input.assetKind,
          assetId: input.assetId,
        },
      ),
    );
  }

  @Get("/assets/:assetKind/:assetId/files/content")
  async content(
    @CurrentPrincipal() principal: Principal,
    @Param("assetKind") assetKind: string,
    @Param("assetId") assetId: string,
    @Query("path") path: string | undefined,
  ): Promise<ReadAssetFileResult> {
    assertPrincipal(principal);
    const input = READ_ASSET_FILE_SCHEMA.parse({ assetKind, assetId, path: path ?? "" });
    return this.guardDenial(() =>
      readAssetFile(
        { repo: this.repo, assets: this.assets },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          assetKind: input.assetKind,
          assetId: input.assetId,
          path: input.path,
        },
      ),
    );
  }

  private async guardDenial<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      // Both collapse to the same bare 404 -- see the header.
      if (e instanceof AssetOrgScopeDeniedError || e instanceof AssetNotFoundError) {
        throw new NotFoundException();
      }
      throw e;
    }
  }
}
