/**
 * `RenameAssetFile` (F143) -- `uc-23-3` R7 rule 3's sibling, domain I-7.
 *
 * ⚠ **Renaming the root file is defined as equivalent to deleting it** (contract's own note
 * on `renameAssetFile`: "改根文件名等价于删根文件 ⇒ 同样 ROOT_FILE_UNDELETABLE"). A rename
 * that keeps the same content but breaks the fixed `SKILL.md`/`AGENT.md` name a runtime looks
 * for is, from the runtime's point of view, indistinguishable from the file having vanished
 * -- so it gets the SAME error code as `deleteAssetFile`'s root-file rejection, checked
 * against `from` (the file being renamed away FROM its root identity), before the
 * `editableBy` gate, for the same reason `delete-asset-file.ts` checks it first.
 */
import { assetGovernance as C } from "@repo/contracts";
import type { z } from "zod";
import { assetFileBadgeFromPath } from "@repo/contracts/asset-governance";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import type { AssetFileRepository, AssetGovernanceRepository } from "./ports";
import { AssetNotFoundError, AssetOrgScopeDeniedError } from "./get-asset-directory";
import { AssetNotEditableError } from "./set-asset-governance";
import { RootFileUndeletableError } from "./delete-asset-file";

export type RenameAssetFileResult = z.infer<typeof C.operations.renameAssetFile.out>;

export interface RenameAssetFileDeps {
  readonly repo: Pick<IdentityRepository, "findOrgMembership">;
  readonly assets: AssetFileRepository;
  readonly governance: AssetGovernanceRepository;
}

export interface RenameAssetFileInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly assetKind: z.infer<typeof C.AssetKind>;
  readonly assetId: string;
  readonly from: string;
  readonly to: string;
}

export async function renameAssetFile(
  deps: RenameAssetFileDeps,
  input: RenameAssetFileInput,
): Promise<RenameAssetFileResult> {
  const membership = await deps.repo.findOrgMembership(input.userId, input.orgId);
  if (membership === null) throw new AssetOrgScopeDeniedError();

  const directory = await deps.assets.getDirectory(input.assetKind, input.assetId);
  if (directory === null) throw new AssetNotFoundError();

  // I-7 -- renaming the root file is treated as deleting it. Checked before editableBy, same
  // reasoning as `delete-asset-file.ts`: not permission-gated, applies to the owner too.
  if (input.from === directory.rootFile) throw new RootFileUndeletableError();

  const governance = await deps.governance.get(input.assetKind, input.assetId);
  if (
    governance !== null &&
    governance.ownerId !== input.userId &&
    !governance.editableBy.includes(input.userId)
  ) {
    throw new AssetNotEditableError();
  }

  const renamed = await deps.assets.renameFile(input.assetKind, input.assetId, input.from, input.to);
  if (renamed === null) throw new AssetNotFoundError();

  return {
    file: {
      path: renamed.path,
      sizeBytes: renamed.sizeBytes,
      badge: assetFileBadgeFromPath(renamed.path),
      isRoot: renamed.path === directory.rootFile,
    },
  };
}
