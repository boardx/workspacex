/**
 * `AlwaysActiveAssetOwnerStatus` -- the phase-1 stand-in for `AssetOwnerStatusPort` (F140).
 *
 * There is no "account deactivated" concept anywhere in this codebase today (`identity`'s
 * `OrgMembershipRow` carries `orgRole` / `teamId`, nothing else) -- so a phase-1 implementation
 * that answered anything but "no, this owner is still active" would be fabricating a signal
 * this org model does not yet have. This mirrors `AlwaysPassingAssetGateStatus`'s own reasoning:
 * the honest answer given what exists, swappable once a real deactivation signal lands.
 */
import type { AssetOwnerStatusPort } from "../../application/asset/ports";

export class AlwaysActiveAssetOwnerStatus implements AssetOwnerStatusPort {
  async isOwnerDeactivated(_ownerId: string): Promise<boolean> {
    return false;
  }
}
