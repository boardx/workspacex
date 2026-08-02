/**
 * F141's two read routes (`GetAssetDirectory` / `ReadAssetFile`), F142's write route
 * (`WriteAssetFile`), and F143's `DeleteAssetFile` / `RenameAssetFile` (root-file protection,
 * domain I-7). Protocol adaptation only -- see `application/asset/*` for the judgement.
 *
 * ⚠ **Read-path denial is a bare 404, not a 403 with a reason.** Both "you are not a member of
 * this organization" and "no such asset" collapse into `NotFoundException()` with no body --
 * following `skills` I-14 (reused by this bundle's `AssetGovernanceError`, see the contract's
 * comment on why there is no separate `ASSET_NOT_FOUND` code). A distinguishable 403 would
 * let a non-member learn that *something* exists at that id even if they cannot read it.
 * ⚠ **The write route's `ASSET_NOT_EDITABLE` / `CONTRACT_VALIDATION_FAILED` are NOT collapsed
 * the same way** -- `write-asset-file.ts`'s own header explains why (they are exactly the
 * information the feature exists to surface, same reasoning as `asset-governance.controller.ts`'s
 * `GOVERNANCE_INCOMPLETE`).
 */
import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Put, Query, UnprocessableEntityException } from "@nestjs/common";
import { assetGovernance as C } from "@repo/contracts";
import {
  AssetNotFoundError,
  AssetOrgScopeDeniedError,
  getAssetDirectory,
  type GetAssetDirectoryResult,
} from "../../application/asset/get-asset-directory";
import { readAssetFile, type ReadAssetFileResult } from "../../application/asset/read-asset-file";
import {
  AssetContractValidationFailedError,
  writeAssetFile,
  type WriteAssetFileResult,
} from "../../application/asset/write-asset-file";
import {
  deleteAssetFile,
  RootFileUndeletableError,
  type DeleteAssetFileResult,
} from "../../application/asset/delete-asset-file";
import { renameAssetFile, type RenameAssetFileResult } from "../../application/asset/rename-asset-file";
import { AssetNotEditableError } from "../../application/asset/set-asset-governance";
import {
  ASSET_FILE_REPOSITORY,
  ASSET_GOVERNANCE_REPOSITORY,
  type AssetFileRepository,
  type AssetGovernanceRepository,
} from "../../application/asset/ports";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

export const GET_ASSET_DIRECTORY_SCHEMA = C.operations.getAssetDirectory.in;
export const READ_ASSET_FILE_SCHEMA = C.operations.readAssetFile.in;
export const WRITE_ASSET_FILE_SCHEMA = C.operations.writeAssetFile.in;
export const DELETE_ASSET_FILE_SCHEMA = C.operations.deleteAssetFile.in;
export const RENAME_ASSET_FILE_SCHEMA = C.operations.renameAssetFile.in;

@Controller()
export class AssetDirectoryController {
  constructor(
    @Inject(ASSET_FILE_REPOSITORY) private readonly assets: AssetFileRepository,
    @Inject(ASSET_GOVERNANCE_REPOSITORY) private readonly governance: AssetGovernanceRepository,
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

  @Put("/assets/:assetKind/:assetId/files/content")
  async write(
    @CurrentPrincipal() principal: Principal,
    @Param("assetKind") assetKind: string,
    @Param("assetId") assetId: string,
    @Body() body: unknown,
  ): Promise<WriteAssetFileResult> {
    assertPrincipal(principal);
    const parsedBody = body as { path?: unknown; body?: unknown } | null;
    const input = WRITE_ASSET_FILE_SCHEMA.parse({
      assetKind,
      assetId,
      path: parsedBody?.path,
      body: parsedBody?.body,
    });
    try {
      return await writeAssetFile(
        { repo: this.repo, assets: this.assets, governance: this.governance },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          assetKind: input.assetKind,
          assetId: input.assetId,
          path: input.path,
          body: input.body,
        },
      );
    } catch (e) {
      // Same bare-404 collapse as the read routes -- see the header.
      if (e instanceof AssetOrgScopeDeniedError || e instanceof AssetNotFoundError) {
        throw new NotFoundException();
      }
      // ⚠ NOT collapsed: these two are exactly the information the feature surfaces.
      if (e instanceof AssetNotEditableError) {
        throw new UnprocessableEntityException({ reasonCode: "ASSET_NOT_EDITABLE" });
      }
      if (e instanceof AssetContractValidationFailedError) {
        throw new UnprocessableEntityException({ reasonCode: "CONTRACT_VALIDATION_FAILED", issues: e.issues });
      }
      throw e;
    }
  }

  @Post("/assets/:assetKind/:assetId/files/delete")
  async delete(
    @CurrentPrincipal() principal: Principal,
    @Param("assetKind") assetKind: string,
    @Param("assetId") assetId: string,
    @Body() body: unknown,
  ): Promise<DeleteAssetFileResult> {
    assertPrincipal(principal);
    const parsedBody = body as { path?: unknown } | null;
    const input = DELETE_ASSET_FILE_SCHEMA.parse({ assetKind, assetId, path: parsedBody?.path });
    try {
      return await deleteAssetFile(
        { repo: this.repo, assets: this.assets, governance: this.governance },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          assetKind: input.assetKind,
          assetId: input.assetId,
          path: input.path,
        },
      );
    } catch (e) {
      if (e instanceof AssetOrgScopeDeniedError || e instanceof AssetNotFoundError) {
        throw new NotFoundException();
      }
      // ⚠ NOT collapsed, same reasoning as `write`'s ASSET_NOT_EDITABLE.
      if (e instanceof AssetNotEditableError) {
        throw new UnprocessableEntityException({ reasonCode: "ASSET_NOT_EDITABLE" });
      }
      if (e instanceof RootFileUndeletableError) {
        throw new UnprocessableEntityException({ reasonCode: "ROOT_FILE_UNDELETABLE" });
      }
      throw e;
    }
  }

  @Post("/assets/:assetKind/:assetId/files/rename")
  async rename(
    @CurrentPrincipal() principal: Principal,
    @Param("assetKind") assetKind: string,
    @Param("assetId") assetId: string,
    @Body() body: unknown,
  ): Promise<RenameAssetFileResult> {
    assertPrincipal(principal);
    const parsedBody = body as { from?: unknown; to?: unknown } | null;
    const input = RENAME_ASSET_FILE_SCHEMA.parse({
      assetKind,
      assetId,
      from: parsedBody?.from,
      to: parsedBody?.to,
    });
    try {
      return await renameAssetFile(
        { repo: this.repo, assets: this.assets, governance: this.governance },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          assetKind: input.assetKind,
          assetId: input.assetId,
          from: input.from,
          to: input.to,
        },
      );
    } catch (e) {
      if (e instanceof AssetOrgScopeDeniedError || e instanceof AssetNotFoundError) {
        throw new NotFoundException();
      }
      if (e instanceof AssetNotEditableError) {
        throw new UnprocessableEntityException({ reasonCode: "ASSET_NOT_EDITABLE" });
      }
      if (e instanceof RootFileUndeletableError) {
        throw new UnprocessableEntityException({ reasonCode: "ROOT_FILE_UNDELETABLE" });
      }
      throw e;
    }
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
