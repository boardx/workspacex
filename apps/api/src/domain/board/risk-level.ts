/**
 * Risk level vocabulary (R1/R2/R3). Derived from `@repo/contracts`, same discipline as
 * `task-status.ts` and `source-kind.ts`.
 *
 * F02/F06 only carry this field for display (uc-11-5 R8 risk-prefix badge) -- the O-26
 * derivation rule table that is supposed to COMPUTE it (uc-11-2 R7) is F03's scope, not
 * built in this feature. A value set on a card at creation time is taken at face value;
 * nothing here re-derives or overrides it.
 */
import { board } from "@repo/contracts";
import type { z } from "zod";

export type RiskLevel = z.infer<typeof board.RiskLevel>;
export const RISK_LEVELS: readonly RiskLevel[] = board.RISK_LEVELS;

export function isRiskLevel(v: unknown): v is RiskLevel {
  return board.RiskLevel.safeParse(v).success;
}
