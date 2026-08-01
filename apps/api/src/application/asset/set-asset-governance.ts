/**
 * `SetAssetGovernance` (F134) -- `uc-23-4` R3, domain I-10 / I-11.
 *
 * 🔴 **The completeness check is the whole point of this feature.** `GOVERNANCE_INCOMPLETE`
 * carries the exact list of missing field names (`missingFields`) rather than a bare code --
 * the acceptance line is "会被明确告知缺的是哪一项，而不是一句笼统的「配置不完整」", and a code
 * with no detail is exactly that blanket message the feature exists to avoid.
 *
 * ⚠ Applies identically across all six `AssetKind`s: nothing here branches on `assetKind`
 * (Q-1b's "unified" reading, `KNOWN_CONTRACT_GAPS.AG1`).
 * ⚠ `负责人 ∈ editableBy` is explicitly NOT enforced here (`Q-9`, contract's own note on
 * `setAssetGovernance`) -- a caller may configure an owner who reviews but does not edit, and
 * forcing membership would make that legitimate configuration inexpressible.
 * ⚠ Editability gate only applies once governance already exists: bootstrapping the very first
 * governance record for an asset cannot be blocked by an `editableBy` set that does not exist
 * yet. Once a record exists, only the owner or a member of `editableBy` may overwrite it.
 */
import { assetGovernance as C } from "@repo/contracts";
import type { z } from "zod";
import { assetGovernanceMissingFields, type AssetGovernanceDraft, type GovernanceField } from "../../domain/asset/asset-governance";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import type { AssetGovernanceRecord, AssetGovernanceRepository } from "./ports";
import { AssetOrgScopeDeniedError } from "./get-asset-directory";

export type SetAssetGovernanceResult = z.infer<typeof C.operations.setAssetGovernance.out>;

/** I-10: one or more of the four required fields is missing. Carries WHICH ones (see header). */
export class GovernanceIncompleteError extends Error {
  readonly code = "GOVERNANCE_INCOMPLETE" as const;
  constructor(readonly missingFields: readonly GovernanceField[]) {
    super(`GOVERNANCE_INCOMPLETE: ${missingFields.join(",")}`);
  }
}

/** Caller is neither the existing owner nor in the existing `editableBy` set. */
export class AssetNotEditableError extends Error {
  readonly code = "ASSET_NOT_EDITABLE" as const;
  constructor() {
    super("ASSET_NOT_EDITABLE");
  }
}

export interface SetAssetGovernanceDeps {
  readonly repo: Pick<IdentityRepository, "findOrgMembership">;
  readonly governance: AssetGovernanceRepository;
}

export interface SetAssetGovernanceInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly assetKind: z.infer<typeof C.AssetKind>;
  readonly assetId: string;
  readonly draft: AssetGovernanceDraft;
}

export async function setAssetGovernance(
  deps: SetAssetGovernanceDeps,
  input: SetAssetGovernanceInput,
): Promise<SetAssetGovernanceResult> {
  const membership = await deps.repo.findOrgMembership(input.userId, input.orgId);
  if (membership === null) throw new AssetOrgScopeDeniedError();

  const missingFields = assetGovernanceMissingFields(input.draft);
  if (missingFields.length > 0) throw new GovernanceIncompleteError(missingFields);

  const existing = await deps.governance.get(input.assetKind, input.assetId);
  if (existing !== null && existing.ownerId !== input.userId && !existing.editableBy.includes(input.userId)) {
    throw new AssetNotEditableError();
  }

  // Fields are guaranteed present past the completeness check above.
  const record: AssetGovernanceRecord = {
    visibility: input.draft.visibility!,
    teamIds: input.draft.visibility === "specified-teams" ? [...(input.draft.teamIds ?? [])] : [],
    editableBy: [...(input.draft.editableBy ?? [])],
    ownerId: input.draft.ownerId!,
    reviewCycle: input.draft.reviewCycle!,
  };
  await deps.governance.set(input.assetKind, input.assetId, record);

  return {
    governance: {
      visibility: record.visibility,
      teamIds: [...record.teamIds],
      editableBy: [...record.editableBy],
      ownerId: record.ownerId,
      reviewCycle: record.reviewCycle,
    },
    // Cosign flow itself is out of scope here -- this feature only surfaces the one bit the
    // contract defines (`requiresCosign`), it does not invent an approval workflow (uc-23-4 A1).
    requiresCosign: record.visibility === "whole-org",
  };
}
