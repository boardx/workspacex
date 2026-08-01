/**
 * `GetAssetGovernance` (F134) -- `uc-23-4` R3.
 *
 * Read-only, same requester gate as `GetAssetDirectory`: org membership. Returning `null` for
 * "never configured" (rather than a record of empty/default values) matters -- an asset that has
 * never had its governance set is a different fact from one that was explicitly set to, say,
 * `private-draft`, and collapsing the two would make "has this asset ever been governed at all"
 * unanswerable (contract's own note on `getAssetGovernance.out`).
 */
import { assetGovernance as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import type { AssetGovernanceRepository } from "./ports";
import { AssetOrgScopeDeniedError } from "./get-asset-directory";

export type GetAssetGovernanceResult = z.infer<typeof C.operations.getAssetGovernance.out>;

export interface GetAssetGovernanceDeps {
  readonly repo: Pick<IdentityRepository, "findOrgMembership">;
  readonly governance: AssetGovernanceRepository;
}

export interface GetAssetGovernanceInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly assetKind: z.infer<typeof C.AssetKind>;
  readonly assetId: string;
}

export async function getAssetGovernance(
  deps: GetAssetGovernanceDeps,
  input: GetAssetGovernanceInput,
): Promise<GetAssetGovernanceResult> {
  const membership = await deps.repo.findOrgMembership(input.userId, input.orgId);
  if (membership === null) throw new AssetOrgScopeDeniedError();

  const record = await deps.governance.get(input.assetKind, input.assetId);
  if (record === null) return { governance: null };

  return {
    governance: {
      visibility: record.visibility,
      teamIds: [...record.teamIds],
      editableBy: [...record.editableBy],
      ownerId: record.ownerId,
      reviewCycle: record.reviewCycle,
    },
  };
}
