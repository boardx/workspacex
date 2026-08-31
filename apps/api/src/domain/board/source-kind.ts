/**
 * Source badge vocabulary (F02/F03). Derived from `@repo/contracts` -- same discipline as
 * `task-status.ts`: the seven strings are declared exactly once, in the contract, because
 * a future frontend badge renderer needs the identical vocabulary.
 */
import { board } from "@repo/contracts";
import type { z } from "zod";

export type SourceKind = z.infer<typeof board.SourceKind>;
export const SOURCE_KINDS: readonly SourceKind[] = board.SOURCE_KINDS;

/**
 * The only value F02 (this feature) ever produces. F03's six automated adapters
 * (现场/会前任务/决策树/报告缺料/转写/研究) are not built yet -- `createTask` (manual
 * creation, uc-11-1 R3.5 "人建的卡不经 inbox") is the one write path that exists today,
 * and it always stamps this value.
 */
export const MANUAL_SOURCE_KIND: SourceKind = board.MANUAL_SOURCE_KIND;

export function isSourceKind(v: unknown): v is SourceKind {
  return board.SourceKind.safeParse(v).success;
}
