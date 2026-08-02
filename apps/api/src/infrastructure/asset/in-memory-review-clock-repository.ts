/**
 * `InMemoryReviewClockRepository` -- the phase-1 implementation of `ReviewClockRepository`
 * (F138, `uc-23-6`).
 *
 * Same rationale as `InMemoryAssetGovernanceRepository` (F134): there is no persisted table for
 * review clocks yet, and building one is a bigger commitment than this feature's scope (the
 * `active <-> pending-review` state machine + review-resets-timer). An in-memory map keeps the
 * read/write path real end to end. F139/F140 can swap this for a `Pg...` implementation without
 * either use case (`review-asset.ts`, `scan-review-clocks.ts`) changing.
 */
import type { AssetKind, ReviewClockRepository } from "../../application/asset/ports";
import type { ReviewClockRecord } from "../../domain/asset/asset-review-clock";

export class InMemoryReviewClockRepository implements ReviewClockRepository {
  private readonly store = new Map<string, ReviewClockRecord>();

  private key(assetKind: AssetKind, assetId: string): string {
    return `${assetKind}:${assetId}`;
  }

  async get(assetKind: AssetKind, assetId: string): Promise<ReviewClockRecord | null> {
    return this.store.get(this.key(assetKind, assetId)) ?? null;
  }

  async save(record: ReviewClockRecord): Promise<void> {
    this.store.set(this.key(record.assetKind as AssetKind, record.assetId), record);
  }

  async listActive(): Promise<readonly ReviewClockRecord[]> {
    return [...this.store.values()].filter((r) => r.state === "active");
  }
}
