/**
 * `InMemoryAssetGovernanceRepository` -- the phase-1 implementation of `AssetGovernanceRepository`
 * (F134).
 *
 * There is, as of F134, no persisted table for governance metadata across all six `AssetKind`s
 * (only `03-skill`'s `Skill` entity and `agent-runtime`'s `McpAuthScope` carry anything
 * comparable, and neither is this contract's shape -- see `KNOWN_CONTRACT_GAPS.AG1`). Building
 * that store is a bigger commitment than "the six-kind-uniform config screen reads/writes its
 * four fields" (this feature's scope); an in-memory map keeps the read/write path real and
 * testable end to end for all six kinds without asserting a persistence design nobody has
 * reviewed yet. Swapping this for a `Pg...` implementation later does not change the port.
 */
import type { AssetGovernanceRecord, AssetGovernanceRepository, AssetKind } from "../../application/asset/ports";

export class InMemoryAssetGovernanceRepository implements AssetGovernanceRepository {
  private readonly store = new Map<string, AssetGovernanceRecord>();

  private key(assetKind: AssetKind, assetId: string): string {
    return `${assetKind}:${assetId}`;
  }

  async get(assetKind: AssetKind, assetId: string): Promise<AssetGovernanceRecord | null> {
    return this.store.get(this.key(assetKind, assetId)) ?? null;
  }

  async set(assetKind: AssetKind, assetId: string, governance: AssetGovernanceRecord): Promise<void> {
    this.store.set(this.key(assetKind, assetId), governance);
  }
}
