/**
 * `AlwaysPassingAssetGateStatus` -- the phase-1 implementation of `AssetGateStatusPort` (F137).
 *
 * The six landing gates (`uc-23-2`) are deferred to phase-2 (Q-0 plan C) -- there is no gate
 * engine in this codebase that could ever produce a blocking verdict yet. Every asset in
 * phase-1 therefore reads as "no blocking gate", which is the honest answer given what exists,
 * not an assumption that gates always pass. See `application/asset/ports.ts`'s
 * `AssetGateStatusPort` header for why this is a port (swappable for a real reader once
 * phase-2 lands) rather than `publishAsset.ts` hard-coding `false`.
 */
import type { AssetGateStatusPort, AssetKind } from "../../application/asset/ports";

export class AlwaysPassingAssetGateStatus implements AssetGateStatusPort {
  async hasBlockingGate(_assetKind: AssetKind, _assetId: string): Promise<boolean> {
    return false;
  }
}
