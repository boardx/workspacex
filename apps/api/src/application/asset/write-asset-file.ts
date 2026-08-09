/**
 * `WriteAssetFile` (F142) -- `uc-23-3` R3 步骤 8-9 / E2 / E7, domain I-25's sibling gate.
 *
 * Two independent gates, checked in this order:
 *   ① **`editableBy` (uc-23-4's "谁能改它")** -- a caller who is not the governance owner and
 *      not in `editableBy` gets `ASSET_NOT_EDITABLE`. This is enforced HERE, not only hidden
 *      behind a missing `[保存]` button in the UI (`uc-23-3` E7 / R12-13's own wording: "就算
 *      绕过界面直接调接口也一样被拒"). ⚠ If governance was never configured for this asset at
 *      all (`governance.get` returns `null`), there is nothing to restrict against yet -- this
 *      mirrors `setAssetGovernance`'s own bootstrap rule (`set-asset-governance.ts`'s header),
 *      so a never-governed asset is writable by any org member until someone sets a
 *      restriction.
 *   ② **Root-file frontmatter** (`uc-23-3` E2 / R12-10) -- only when `path` IS the asset's
 *      `rootFile` (`SKILL.md` / `AGENT.md`) does a broken frontmatter block reject the save.
 *      Any other file in the tree has no frontmatter contract to check.
 *
 * 🔴 **Deliberately does NOT re-run gate 02 as a side effect** (`AG6` / I-25, `[待确认]`) --
 *   see the contract's own long note on `writeAssetFile`. Not this feature's call to make.
 * 🔴 **No optimistic-concurrency field** (`AG5`, `uc-23-3` E5) -- last-write-wins, on purpose,
 *   because the alternative requires a ruling nobody has made yet.
 */
import { assetGovernance as C } from "@repo/contracts";
import type { z } from "zod";
import {
  isRootFrontmatterAssetKind,
  validateRootFrontmatter,
  type FrontmatterIssue,
} from "../../domain/asset/asset-root-frontmatter";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import type { AssetFileRepository, AssetGovernanceRepository } from "./ports";
import { AssetNotFoundError, AssetOrgScopeDeniedError } from "./get-asset-directory";
import { AssetNotEditableError } from "./set-asset-governance";

export type WriteAssetFileResult = z.infer<typeof C.operations.writeAssetFile.out>;

/** Root file's frontmatter unparsable or missing a required field. **Never written.** */
export class AssetContractValidationFailedError extends Error {
  readonly code = "CONTRACT_VALIDATION_FAILED" as const;
  constructor(readonly issues: readonly FrontmatterIssue[]) {
    super(`CONTRACT_VALIDATION_FAILED: ${issues.map((i) => i.field).join(",")}`);
  }
}

export interface WriteAssetFileDeps {
  readonly repo: Pick<IdentityRepository, "findOrgMembership">;
  readonly assets: AssetFileRepository;
  readonly governance: AssetGovernanceRepository;
}

export interface WriteAssetFileInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly assetKind: z.infer<typeof C.AssetKind>;
  readonly assetId: string;
  readonly path: string;
  readonly body: string;
}

export async function writeAssetFile(
  deps: WriteAssetFileDeps,
  input: WriteAssetFileInput,
): Promise<WriteAssetFileResult> {
  const membership = await deps.repo.findOrgMembership(input.userId, input.orgId);
  if (membership === null) throw new AssetOrgScopeDeniedError();

  const directory = await deps.assets.getDirectory(input.orgId, input.assetKind, input.assetId);
  if (directory === null) throw new AssetNotFoundError();

  // ① editableBy gate -- server-side, independent of whatever the UI renders (uc-23-3 E7).
  const governance = await deps.governance.get(input.assetKind, input.assetId);
  if (
    governance !== null &&
    governance.ownerId !== input.userId &&
    !governance.editableBy.includes(input.userId)
  ) {
    throw new AssetNotEditableError();
  }

  // ② root-file frontmatter gate -- only the root file has a contract to check (uc-23-3 E2).
  if (input.path === directory.rootFile && isRootFrontmatterAssetKind(input.assetKind)) {
    const issues = validateRootFrontmatter(input.assetKind, input.body);
    if (issues.length > 0) throw new AssetContractValidationFailedError(issues);
  }

  const written = await deps.assets.writeFile(input.orgId, input.assetKind, input.assetId, input.path, input.body);
  if (written === null) throw new AssetNotFoundError();

  return { sizeBytes: written.sizeBytes, dirty: true };
}
