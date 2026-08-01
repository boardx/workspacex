/**
 * `RunPreflightChecks` (F136) -- `uc-23-4` R3 第四项, domain I-22.
 *
 * Reads whatever governance has actually been persisted for `(assetKind, assetId)` (never a
 * default record -- an asset that has never been governed at all reads as "all four fields
 * missing", same as `GetAssetGovernance`'s `null` handling) and hands it to the pure
 * `assetPreflightItems` derivation. This use case owns no judgement of its own beyond that
 * read + the `blockingCount` tally -- the actual rule content lives in
 * `../../domain/asset/asset-preflight.ts` on purpose, so it stays a single, testable, derived
 * source (`uc-23-4` R3 note on F136).
 */
import { assetGovernance as C } from "@repo/contracts";
import type { z } from "zod";
import { assetPreflightItems } from "../../domain/asset/asset-preflight";
import type { AssetGovernanceDraft } from "../../domain/asset/asset-governance";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import type { AssetGovernanceRepository } from "./ports";
import { AssetOrgScopeDeniedError } from "./get-asset-directory";

export type RunPreflightChecksResult = z.infer<typeof C.operations.runPreflightChecks.out>;

export interface RunPreflightChecksDeps {
  readonly repo: Pick<IdentityRepository, "findOrgMembership">;
  readonly governance: AssetGovernanceRepository;
}

export interface RunPreflightChecksInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly assetKind: z.infer<typeof C.AssetKind>;
  readonly assetId: string;
}

export async function runPreflightChecks(
  deps: RunPreflightChecksDeps,
  input: RunPreflightChecksInput,
): Promise<RunPreflightChecksResult> {
  const membership = await deps.repo.findOrgMembership(input.userId, input.orgId);
  if (membership === null) throw new AssetOrgScopeDeniedError();

  const record = await deps.governance.get(input.assetKind, input.assetId);
  const draft: AssetGovernanceDraft = record === null
    ? {}
    : {
      visibility: record.visibility,
      teamIds: [...record.teamIds],
      editableBy: [...record.editableBy],
      ownerId: record.ownerId,
      reviewCycle: record.reviewCycle,
    };

  const items = assetPreflightItems(draft);
  const blockingCount = items.filter((item) => item.blocking && !item.passed).length;
  return { items, blockingCount };
}
