/**
 * The five-state task status vocabulary. Innermost layer of the `board` domain.
 *
 * ## Why this is DERIVED from `@repo/contracts` rather than declared here
 *
 * `TaskStatus` already exists as a zod enum in the contract (`packages/contracts/src/board.ts`)
 * so that a future frontend consumer imports the exact same values instead of retyping them.
 * Declaring the five strings again here would be a second copy of the same fact -- the
 * failure mode AGENTS.md calls out by name (design tokens / font-size tiers / discard-reason
 * enum / withdrawal-chain SLA / point estimates, five times already). This file is the sixth
 * candidate, and it does not get to be a sixth instance.
 *
 * Importing a pure vocabulary package inward is not a layering violation, same reasoning as
 * `apps/api/src/domain/identity/roles.ts`: `@repo/contracts` has no I/O, no framework, no
 * infrastructure.
 */
import { board } from "@repo/contracts";
import type { z } from "zod";

export type TaskStatus = z.infer<typeof board.TaskStatus>;

/**
 * The five values, in their natural forward order. This is the ONLY place ordering is
 * expressed -- O-27's "forward jump vs. backward move" distinction (`transition-matrix.ts`)
 * is computed from the INDEX in this array, never from a second hand-authored ordering.
 */
export const TASK_STATUSES: readonly TaskStatus[] = board.TASK_STATUSES;

export function isTaskStatus(v: unknown): v is TaskStatus {
  return board.TaskStatus.safeParse(v).success;
}

/** Position of a status in the forward sequence. Higher = further along. */
export function statusRank(status: TaskStatus): number {
  return TASK_STATUSES.indexOf(status);
}
