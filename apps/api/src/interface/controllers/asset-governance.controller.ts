/**
 * F134's two routes (`GetAssetGovernance` / `SetAssetGovernance`, `uc-23-4` R3). Protocol
 * adaptation only -- see `application/asset/{get,set}-asset-governance.ts` for the judgement.
 *
 * ⚠ `GOVERNANCE_INCOMPLETE` carries `missingFields` in the response body -- unlike the bare-404
 * denial pattern in `asset-directory.controller.ts`, this rejection is not a security-sensitive
 * existence signal, it is exactly the piece of information the feature exists to surface (see
 * `set-asset-governance.ts`'s header).
 */
import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Put, UnprocessableEntityException } from "@nestjs/common";
import { assetGovernance as C } from "@repo/contracts";
import {
  getAssetGovernance,
  type GetAssetGovernanceResult,
} from "../../application/asset/get-asset-governance";
import {
  AssetNotEditableError,
  GovernanceIncompleteError,
  setAssetGovernance,
  type SetAssetGovernanceResult,
} from "../../application/asset/set-asset-governance";
import {
  runPreflightChecks,
  type RunPreflightChecksResult,
} from "../../application/asset/run-preflight-checks";
import {
  GateNotPassedError,
  PreflightHasBlockingItemError,
  publishAsset,
  type PublishAssetResult,
} from "../../application/asset/publish-asset";
import { AssetNotFoundError, AssetOrgScopeDeniedError } from "../../application/asset/get-asset-directory";
import {
  ASSET_GATE_STATUS_PORT,
  ASSET_GOVERNANCE_REPOSITORY,
  type AssetGateStatusPort,
  type AssetGovernanceRepository,
} from "../../application/asset/ports";
import { CLOCK, type Clock } from "../../application/auth/ports";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { PROVENANCE_WRITER, type ProvenanceWriter } from "../../application/provenance/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

export const GET_ASSET_GOVERNANCE_SCHEMA = C.operations.getAssetGovernance.in;
export const SET_ASSET_GOVERNANCE_SCHEMA = C.operations.setAssetGovernance.in;
export const RUN_PREFLIGHT_CHECKS_SCHEMA = C.operations.runPreflightChecks.in;
export const PUBLISH_ASSET_SCHEMA = C.operations.publishAsset.in;

@Controller()
export class AssetGovernanceController {
  constructor(
    @Inject(ASSET_GOVERNANCE_REPOSITORY) private readonly governance: AssetGovernanceRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(ASSET_GATE_STATUS_PORT) private readonly gates: AssetGateStatusPort,
    @Inject(PROVENANCE_WRITER) private readonly provenance: ProvenanceWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get("/assets/:assetKind/:assetId/governance")
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param("assetKind") assetKind: string,
    @Param("assetId") assetId: string,
  ): Promise<GetAssetGovernanceResult> {
    assertPrincipal(principal);
    const input = GET_ASSET_GOVERNANCE_SCHEMA.parse({ assetKind, assetId });
    try {
      return await getAssetGovernance(
        { repo: this.repo, governance: this.governance },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          assetKind: input.assetKind,
          assetId: input.assetId,
        },
      );
    } catch (e) {
      if (e instanceof AssetOrgScopeDeniedError || e instanceof AssetNotFoundError) throw new NotFoundException();
      throw e;
    }
  }

  @Put("/assets/:assetKind/:assetId/governance")
  async set(
    @CurrentPrincipal() principal: Principal,
    @Param("assetKind") assetKind: string,
    @Param("assetId") assetId: string,
    @Body() body: unknown,
  ): Promise<SetAssetGovernanceResult> {
    assertPrincipal(principal);
    const input = SET_ASSET_GOVERNANCE_SCHEMA.parse({ assetKind, assetId, governance: (body as { governance?: unknown })?.governance });
    try {
      return await setAssetGovernance(
        { repo: this.repo, governance: this.governance },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          assetKind: input.assetKind,
          assetId: input.assetId,
          draft: input.governance,
        },
      );
    } catch (e) {
      if (e instanceof AssetOrgScopeDeniedError) throw new NotFoundException();
      if (e instanceof GovernanceIncompleteError) {
        throw new UnprocessableEntityException({ reasonCode: "GOVERNANCE_INCOMPLETE", missingFields: e.missingFields });
      }
      if (e instanceof AssetNotEditableError) {
        throw new UnprocessableEntityException({ reasonCode: "ASSET_NOT_EDITABLE" });
      }
      throw e;
    }
  }

  /**
   * `RunPreflightChecks` (F136) -- `uc-23-4` R3 第四项 / domain I-22. See
   * `application/asset/run-preflight-checks.ts` for the derivation; this method is protocol
   * adaptation only.
   */
  @Get("/assets/:assetKind/:assetId/preflight")
  async preflight(
    @CurrentPrincipal() principal: Principal,
    @Param("assetKind") assetKind: string,
    @Param("assetId") assetId: string,
  ): Promise<RunPreflightChecksResult> {
    assertPrincipal(principal);
    const input = RUN_PREFLIGHT_CHECKS_SCHEMA.parse({ assetKind, assetId });
    try {
      return await runPreflightChecks(
        { repo: this.repo, governance: this.governance },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          assetKind: input.assetKind,
          assetId: input.assetId,
        },
      );
    } catch (e) {
      if (e instanceof AssetOrgScopeDeniedError || e instanceof AssetNotFoundError) throw new NotFoundException();
      throw e;
    }
  }

  /**
   * `PublishAsset` (F137) -- `uc-23-4` R3 第五步 / R7 规则 1-2. See
   * `application/asset/publish-asset.ts` for the three independent blockers; this method is
   * protocol adaptation only.
   */
  @Post("/assets/:assetKind/:assetId/publish")
  async publish(
    @CurrentPrincipal() principal: Principal,
    @Param("assetKind") assetKind: string,
    @Param("assetId") assetId: string,
    @Body() body: unknown,
  ): Promise<PublishAssetResult> {
    assertPrincipal(principal);
    const input = PUBLISH_ASSET_SCHEMA.parse({ assetKind, assetId, mode: (body as { mode?: unknown })?.mode });
    try {
      return await publishAsset(
        { repo: this.repo, governance: this.governance, gates: this.gates, provenance: this.provenance, clock: this.clock },
        {
          userId: principal.userId,
          orgId: toOrgId(principal.orgId),
          assetKind: input.assetKind,
          assetId: input.assetId,
          mode: input.mode,
        },
      );
    } catch (e) {
      if (e instanceof AssetOrgScopeDeniedError) throw new NotFoundException();
      if (e instanceof GateNotPassedError) {
        throw new UnprocessableEntityException({ reasonCode: "GATE_NOT_PASSED" });
      }
      if (e instanceof GovernanceIncompleteError) {
        throw new UnprocessableEntityException({ reasonCode: "GOVERNANCE_INCOMPLETE", missingFields: e.missingFields });
      }
      if (e instanceof PreflightHasBlockingItemError) {
        throw new UnprocessableEntityException({ reasonCode: "PREFLIGHT_HAS_BLOCKING_ITEM", blockingCount: e.blockingCount });
      }
      throw e;
    }
  }
}
