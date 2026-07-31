/**
 * F34's two contract-state routes (uc-22-1 R7): protocol adaptation only, every judgement is
 * in `application/files/rename-artifact.ts`.
 *
 *   POST /artifacts/:artifactId/rename     contract `renameArtifact`
 *   GET  /artifact-aliases/resolve         contract `resolveArtifactAlias`
 *
 * ⚠ `renameArtifact`'s denial is a 403 WITH a `reasonCode` (`PROJECT_ROLE_INSUFFICIENT`) --
 * unlike the delivery routes, this operation's signed `err` list has no bare-404 requirement
 * (N-25's byte-identical rule is about VISIBILITY denials on `previewArtifactVersion` /
 * `issueDownloadUrl`; renaming is a write action on an artifact whose existence the caller
 * already knows, since `renameArtifact.in` takes an `artifactId` the caller must have gotten
 * from the browser they can already see it in).
 */
import { Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { files as C } from "@repo/contracts";
import {
  RenameArtifactError,
  renameArtifact,
  resolveArtifactAlias,
  type RenameArtifactResult,
  type RenameDeps,
  type ResolveArtifactAliasResult,
} from "../../application/files/rename-artifact";
import { ARTIFACT_RENAME_REPOSITORY, type ArtifactRenameRepository } from "../../application/files/rename-ports";
import {
  DECISION_ID_FACTORY, IDENTITY_REPOSITORY, type DecisionIdFactory, type IdentityRepository,
} from "../../application/identity/ports";
import { ID_FACTORY, type IdFactory } from "../../application/artifact/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

export const RENAME_ARTIFACT_SCHEMA = C.operations.renameArtifact.in;
export const RESOLVE_ALIAS_SCHEMA = C.operations.resolveArtifactAlias.in;

@Controller()
export class FilesRenameController {
  constructor(
    @Inject(ARTIFACT_RENAME_REPOSITORY) private readonly aliases: ArtifactRenameRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(ID_FACTORY) private readonly idFactory: IdFactory,
  ) {}

  private get deps(): RenameDeps {
    return { repo: this.repo, ids: this.ids, aliases: this.aliases, idFactory: this.idFactory };
  }

  @Post("/artifacts/:artifactId/rename")
  async rename(
    @CurrentPrincipal() principal: Principal,
    @Param("artifactId") artifactId: string,
    @Query("newName") newName: string | undefined,
    @Query("reason") reason: string | undefined,
  ): Promise<RenameArtifactResult> {
    assertPrincipal(principal);
    const input = RENAME_ARTIFACT_SCHEMA.parse({ artifactId, newName, reason });
    return this.mapErrors(() =>
      renameArtifact(this.deps, {
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        artifactId: input.artifactId,
        newName: input.newName,
        reason: input.reason,
      }),
    );
  }

  @Get("/artifact-aliases/resolve")
  async resolve(
    @CurrentPrincipal() principal: Principal,
    @Query("projectId") projectId: string,
    @Query("path") path: string,
  ): Promise<ResolveArtifactAliasResult> {
    assertPrincipal(principal);
    const input = RESOLVE_ALIAS_SCHEMA.parse({ projectId, path });
    return this.mapErrors(() =>
      resolveArtifactAlias(this.deps, {
        userId: principal.userId,
        orgId: toOrgId(principal.orgId),
        projectId: input.projectId,
        path: input.path,
      }),
    );
  }

  private async mapErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof RenameArtifactError)) throw e;
      switch (e.reasonCode) {
        case "ARTIFACT_NOT_FOUND":
          throw new NotFoundException();
        case "PROJECT_ROLE_INSUFFICIENT":
        case "NO_PROJECT_ROLE":
          throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
    }
  }
}
