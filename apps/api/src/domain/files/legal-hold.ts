/**
 * F46 -- legal hold write-side rules (uc-22-4 R3.d 点 15, `applyLegalHold`/`releaseLegalHold`).
 *
 * F45 already owns the READ side (`LegalHoldGate.isActive`, consumed by `requestDeletion`'s
 * `LEGAL_HOLD_ACTIVE` gate) and the storage table (`legal_holds`, migration
 * `20260801210000_f45_deletion_cascade.sql`) -- see that migration's header, which says in
 * so many words: "施加/解除 write paths ... F46's job". This file is the pure half of that
 * write path: what makes an apply/release request well-formed, kept separate from the
 * database so it can be asserted without one.
 *
 * ⚠ "全程留痕" (R3.d 点 15 / usecases.md `releaseLegalHold`'s own comment: "解除比施加更需要
 * 问责") is not optional metadata -- both `HoldApplication` and `HoldRelease` below are
 * shaped so a caller CANNOT construct one without who/when/why, matching the
 * `legal_holds_release_all_or_none` CHECK constraint the migration already put at the
 * schema level (three release fields, all-or-nothing).
 */

export interface ActiveHold {
  readonly holdId: string;
  readonly artifactId: string;
  readonly reason: string;
  readonly appliedBy: string;
  readonly appliedAt: Date;
}

export interface HoldApplication {
  readonly holdId: string;
  readonly artifactId: string;
  readonly reason: string;
  readonly appliedBy: string;
  readonly appliedAt: Date;
}

export interface HoldRelease {
  readonly holdId: string;
  readonly releasedBy: string;
  readonly releasedAt: Date;
  readonly releaseReason: string;
}

export class LegalHoldError extends Error {
  constructor(readonly reasonCode: "REASON_REQUIRED" | "ALREADY_ACTIVE" | "NOT_ACTIVE") {
    super(reasonCode);
  }
}

const MIN_REASON_LENGTH = 1; // matches `applyLegalHold.in.reason` / `releaseLegalHold.in.reason`'s own `.min(1)` -- not a fresh threshold, a defensive re-check of the same contract bound (same discipline as `request-deletion.ts`'s re-check of `reason.length < 4`).

/**
 * Builds the write record for `applyLegalHold`. Throws `REASON_REQUIRED` on a blank reason
 * (defensive -- the contract's `z.string().min(1)` already blocks this at the boundary) and
 * `ALREADY_ACTIVE` when the caller already knows of a currently-active hold for this
 * artifact (the actual uniqueness is enforced by `legal_holds_active_uniq`; this lets the
 * application layer report a clean domain error instead of leaking a constraint-violation).
 */
export function buildHoldApplication(input: {
  readonly holdId: string;
  readonly artifactId: string;
  readonly reason: string;
  readonly appliedBy: string;
  readonly appliedAt: Date;
  readonly existingActiveHold: boolean;
}): HoldApplication {
  if (input.reason.trim().length < MIN_REASON_LENGTH) throw new LegalHoldError("REASON_REQUIRED");
  if (input.existingActiveHold) throw new LegalHoldError("ALREADY_ACTIVE");
  return {
    holdId: input.holdId,
    artifactId: input.artifactId,
    reason: input.reason,
    appliedBy: input.appliedBy,
    appliedAt: input.appliedAt,
  };
}

/**
 * Builds the write record for `releaseLegalHold`. `NOT_ACTIVE` when there is no active hold
 * to release -- releasing something that was never held is not idempotent-safe here (unlike
 * `requestDeletion`'s re-invalidation): it would fabricate an audit entry for an event that
 * never happened, exactly the kind of "回执照出，而边还在图里" shape this bundle forbids
 * elsewhere for a different fact.
 */
export function buildHoldRelease(input: {
  readonly activeHold: ActiveHold | null;
  readonly releasedBy: string;
  readonly releasedAt: Date;
  readonly releaseReason: string;
}): HoldRelease {
  if (input.releaseReason.trim().length < MIN_REASON_LENGTH) throw new LegalHoldError("REASON_REQUIRED");
  if (input.activeHold === null) throw new LegalHoldError("NOT_ACTIVE");
  return {
    holdId: input.activeHold.holdId,
    releasedBy: input.releasedBy,
    releasedAt: input.releasedAt,
    releaseReason: input.releaseReason,
  };
}
