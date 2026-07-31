/**
 * `GetAssetDirectory` (F141) -- `uc-23-3` R3 步骤 2, R12-1/2.
 *
 * The org-membership check is the WHOLE requester gate here, deliberately: the contract's
 * `err` union for this operation is exactly `["ORG_SCOPE_DENIED", "AUTH_SERVICE_UNAVAILABLE"]`
 * -- no `PROJECT_ROLE_INSUFFICIENT`, because a directory read isn't scoped to a project. A
 * non-member is refused; a member always passes this gate (the "who may EDIT" question is
 * `uc-23-4`'s `AssetGovernance.editableBy`, and F141 is read-only -- see `AssetNotEditableError`
 * further down the feature list, F142).
 *
 * `getDirectory` returning `null` (unknown assetId, or a kind outside the 2/6 this port
 * supports -- AG4) and "org member but asset does not exist" collapse into the SAME outcome,
 * a bare not-found, following `skills` I-14: existence must not be distinguishable from
 * "not in your organization" by the shape of the response.
 */
import { assetGovernance as C } from "@repo/contracts";
import type { z } from "zod";
import { buildAssetDirectory } from "../../domain/asset/asset-directory";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import type { AssetFileRepository } from "./ports";

export type GetAssetDirectoryResult = z.infer<typeof C.operations.getAssetDirectory.out>;

export class AssetOrgScopeDeniedError extends Error {
  constructor() {
    super("asset_org_scope_denied");
  }
}

/** Unknown asset, or a kind this port group does not (yet) cover. One outcome, see header. */
export class AssetNotFoundError extends Error {
  constructor() {
    super("asset_not_found");
  }
}

export interface GetAssetDirectoryDeps {
  readonly repo: Pick<IdentityRepository, "findOrgMembership">;
  readonly assets: AssetFileRepository;
}

export interface GetAssetDirectoryInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly assetKind: z.infer<typeof C.AssetKind>;
  readonly assetId: string;
}

export async function getAssetDirectory(
  deps: GetAssetDirectoryDeps,
  input: GetAssetDirectoryInput,
): Promise<GetAssetDirectoryResult> {
  const membership = await deps.repo.findOrgMembership(input.userId, input.orgId);
  if (membership === null) throw new AssetOrgScopeDeniedError();

  const record = await deps.assets.getDirectory(input.assetKind, input.assetId);
  if (record === null) throw new AssetNotFoundError();

  const built = buildAssetDirectory(record.rootFile, record.entries);
  // The contract's inferred type is mutable arrays; the domain builder returns `readonly`
  // ones (deliberately, as a value object). Spreading here is copying, not casting the
  // guarantee away -- `buildAssetDirectory`'s caller-visible return type is unaffected.
  return { rootFile: built.rootFile, tree: [...built.tree], files: [...built.files] };
}
