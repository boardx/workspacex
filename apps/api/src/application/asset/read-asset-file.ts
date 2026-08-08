/**
 * `ReadAssetFile` (F141) -- `uc-23-3` R3 步骤 5-6.
 *
 * ⚠ **Not gated on `editableBy`.** The contract's own note is explicit: "不在 `editableBy`
 * 内的人仍可读（只读态），这与「不可见」是两件事". So this use case asks only the same
 * question `getAssetDirectory` asks -- org membership -- and nothing narrower. F142 is where
 * a write attempt gets checked against `editableBy`; reading never does.
 */
import { assetGovernance as C } from "@repo/contracts";
import type { z } from "zod";
import { assetFileBadgeFromPath } from "@repo/contracts/asset-governance";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import type { AssetFileRepository } from "./ports";
import { AssetOrgScopeDeniedError, AssetNotFoundError } from "./get-asset-directory";

export type ReadAssetFileResult = z.infer<typeof C.operations.readAssetFile.out>;

export interface ReadAssetFileDeps {
  readonly repo: Pick<IdentityRepository, "findOrgMembership">;
  readonly assets: AssetFileRepository;
}

export interface ReadAssetFileInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly assetKind: z.infer<typeof C.AssetKind>;
  readonly assetId: string;
  readonly path: string;
}

export async function readAssetFile(
  deps: ReadAssetFileDeps,
  input: ReadAssetFileInput,
): Promise<ReadAssetFileResult> {
  const membership = await deps.repo.findOrgMembership(input.userId, input.orgId);
  if (membership === null) throw new AssetOrgScopeDeniedError();

  const record = await deps.assets.readFile(input.orgId, input.assetKind, input.assetId, input.path);
  if (record === null) throw new AssetNotFoundError();

  return {
    path: input.path,
    sizeBytes: record.sizeBytes,
    body: record.body,
    badge: assetFileBadgeFromPath(input.path),
  };
}
