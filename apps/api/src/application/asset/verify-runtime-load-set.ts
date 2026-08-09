/**
 * `VerifyRuntimeLoadSet` (F143) -- application-layer assembly of domain I-6's bidirectional
 * check (`uc-23-3` R7 rule 1 / R12-11). Not a contract operation: this is an invariant CHECK,
 * not a new user-facing capability, so it does not add a route or a zod schema -- it exists
 * to be asserted in tests (and, later, wherever a publish/runtime-load path wants to guard
 * itself) against real ports rather than only the pure domain function in isolation.
 */
import { computeRuntimeLoadSetDiff, type RuntimeLoadSetDiff } from "../../domain/asset/runtime-load-set";
import type { OrgId } from "../../domain/org-id";
import type { AssetFileRepository, AssetKind, AssetRuntimeLoaderPort } from "./ports";

export class AssetRuntimeLoadSetNotFoundError extends Error {
  constructor() {
    super("asset_runtime_load_set_not_found");
  }
}

export interface VerifyRuntimeLoadSetDeps {
  readonly assets: AssetFileRepository;
  readonly runtime: AssetRuntimeLoaderPort;
}

export interface VerifyRuntimeLoadSetInput {
  readonly orgId: OrgId;
  readonly assetKind: AssetKind;
  readonly assetId: string;
}

export async function verifyRuntimeLoadSet(
  deps: VerifyRuntimeLoadSetDeps,
  input: VerifyRuntimeLoadSetInput,
): Promise<RuntimeLoadSetDiff> {
  const directory = await deps.assets.getDirectory(input.orgId, input.assetKind, input.assetId);
  if (directory === null) throw new AssetRuntimeLoadSetNotFoundError();

  const runtimePaths = await deps.runtime.loadedFilePaths(input.orgId, input.assetKind, input.assetId);
  if (runtimePaths === null) throw new AssetRuntimeLoadSetNotFoundError();

  const directoryPaths = directory.entries.map((e) => e.path);
  return computeRuntimeLoadSetDiff(directoryPaths, runtimePaths);
}
