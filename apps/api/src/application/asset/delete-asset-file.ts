/**
 * `DeleteAssetFile` (F143) -- `uc-23-3` R7 rule 3 / R12-9, domain I-7.
 *
 * ⚠ **Root-file check happens BEFORE the `editableBy` gate.** "根文件不可删" is not a
 * permission question -- even the asset's owner cannot delete `SKILL.md` / `AGENT.md`. Gating
 * it behind `editableBy` first would make `ROOT_FILE_UNDELETABLE` unreachable for someone
 * who legitimately CAN edit the asset, which is exactly the population this rule most needs
 * to bind (an outsider has no delete button to begin with; the maintainer does).
 */
import { assetGovernance as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import type { AssetFileRepository, AssetGovernanceRepository } from "./ports";
import { AssetNotFoundError, AssetOrgScopeDeniedError } from "./get-asset-directory";
import { AssetNotEditableError } from "./set-asset-governance";

export type DeleteAssetFileResult = z.infer<typeof C.operations.deleteAssetFile.out>;

/** I-7: `path === rootFile` -- the org's root file for this asset kind, never deletable. */
export class RootFileUndeletableError extends Error {
  readonly code = "ROOT_FILE_UNDELETABLE" as const;
  constructor() {
    super("ROOT_FILE_UNDELETABLE");
  }
}

export interface DeleteAssetFileDeps {
  readonly repo: Pick<IdentityRepository, "findOrgMembership">;
  readonly assets: AssetFileRepository;
  readonly governance: AssetGovernanceRepository;
}

export interface DeleteAssetFileInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly assetKind: z.infer<typeof C.AssetKind>;
  readonly assetId: string;
  readonly path: string;
}

export async function deleteAssetFile(
  deps: DeleteAssetFileDeps,
  input: DeleteAssetFileInput,
): Promise<DeleteAssetFileResult> {
  const membership = await deps.repo.findOrgMembership(input.userId, input.orgId);
  if (membership === null) throw new AssetOrgScopeDeniedError();

  const directory = await deps.assets.getDirectory(input.assetKind, input.assetId);
  if (directory === null) throw new AssetNotFoundError();

  // I-7 -- checked before editableBy: not deletable by ANYONE, not even the owner.
  if (input.path === directory.rootFile) throw new RootFileUndeletableError();

  const governance = await deps.governance.get(input.assetKind, input.assetId);
  if (
    governance !== null &&
    governance.ownerId !== input.userId &&
    !governance.editableBy.includes(input.userId)
  ) {
    throw new AssetNotEditableError();
  }

  const deleted = await deps.assets.deleteFile(input.assetKind, input.assetId, input.path);
  if (deleted === null) throw new AssetNotFoundError();

  return { deleted };
}
