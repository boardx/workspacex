/**
 * F45 -- pure rules for the delete-impact preview, the six-category cascade, and the
 * two-tier SLA (uc-22-4 R3.c, R7, R12 V4/V5/V6/V7).
 *
 * ## Why the six kinds live here and not just in `@repo/contracts`
 *
 * `files.CascadeKind` (the contract) is the SIGNED enum -- the shape. This file is the
 * ORCHESTRATION RULE over that shape: given a set of per-kind outcomes, what is the task's
 * overall status. That rule is exactly what R7 states in prose ("六类级联缺一即验收不通过",
 * "部分失败的删除不得标为完成、不得出回执" -- N-17) and it is pure enough to be tested without
 * a database, which is the whole point of putting it here rather than inline in the use case.
 *
 * ## `"done"` is never returned by this module, on purpose
 *
 * The six-category cascade this file judges is the LOGICAL half (R3.c step 9, "即时 ≤5
 * 分钟"). `getDeletionTask.out.status` also covers the PHYSICAL half (step 11, "≤30 天"),
 * which is F46's worker. Returning `"done"` from here the moment all six logical outcomes
 * are `"ok"` would let a task read as fully complete while the object still exists in
 * storage -- exactly the "回执照出，而边还在图里" shape N-17 exists to forbid, just moved one
 * step earlier. So the ceiling this module can reach is `"running"` (logical cascade clean,
 * physical deletion still pending); `"done"` is set only by the physical-delete worker, and
 * only once a receipt actually exists (N-18).
 *
 * ## The single source for the two deadlines is `@repo/contracts/org-admin`
 *
 * `WITHDRAWAL_SLA_MS` (5 min / 30 days, D-15) already exists there -- `withdraw-participant-
 * phone.ts` (F14's minimal slice) computes its two deadlines from it. This file reuses the
 * SAME constant rather than writing `5 * 60_000` a second time: D-15 is one ruling, and a
 * second numeric literal for it is exactly the "same fact declared twice" failure this repo
 * has hit five times (AGENTS.md). If D-15 is ever revised, there is one place to change.
 */
import { files as C, orgAdmin as OA } from "@repo/contracts";
import type { z } from "zod";

/**
 * ⚠ 六值的唯一事实源是 `packages/contracts/src/files.ts` 的 `CascadeKind`（`z.enum`）。
 * 这里只是把它的 `options` 摊平成一个数组，供 `assertSixCascadeKinds` 在运行时逐项核对——
 * 不是第二份定义；契约改动会自动带动这里，不需要手改两处（ADR-020）。六值含义：
 * ① browser-entry 浏览器条目消失 ② derived-files 派生文件进队列 ③ pgvector embedding 退出
 * ④ fts-segments FTS/Segment 退出召回 ⑤ ontology-edges 相关边失效（跨 09-kg，phase-02
 * 契约桩 F47） ⑥ context-pack-cache 缓存与已构建 Context Pack 失效。
 */
export const CASCADE_KINDS = C.CascadeKind.options;

export type CascadeKind = z.infer<typeof C.CascadeKind>;
export type CascadeOutcome = "ok" | "failed" | "pending";
export type DeletionTaskStatus = "pending" | "running" | "done" | "partial-failure";

export interface CascadeResultEntry {
  readonly kind: CascadeKind;
  readonly result: CascadeOutcome;
  /** Free-text reason, mainly populated for `"failed"` (e.g. which outbound port threw). */
  readonly detail: string | null;
}

/**
 * 🔴 R11 / architecture 首批门槛第 4 条: six entries, one per `CascadeKind`, every time.
 *
 * A caller that supplies fewer than six entries has not run the cascade, it has run PART of
 * it -- and the whole point of "逐类验收" is that this is checkable mechanically rather than
 * trusted. Throwing here (a programming error, not a business outcome) is what makes a
 * four-category implementation fail LOUDLY instead of quietly reporting `"running"`.
 */
export function assertSixCascadeKinds(results: readonly CascadeResultEntry[]): void {
  const seen = new Set(results.map((r) => r.kind));
  if (seen.size !== CASCADE_KINDS.length || !CASCADE_KINDS.every((k) => seen.has(k))) {
    const missing = CASCADE_KINDS.filter((k) => !seen.has(k));
    throw new Error(
      `deletion cascade must report exactly the six CascadeKind entries; missing: ${missing.join(", ") || "(duplicates)"}`,
    );
  }
}

/**
 * The logical-cascade half of `getDeletionTask.out.status`.
 *
 * ⚠ `"done"` is never returned -- see the file header. A single `"failed"` entry (today,
 * that is always at least `ontology-edges`, since `invalidateOntologyEdges` is a phase-01
 * stub that never succeeds -- `files-outbound-stubs.ts`'s own rule) makes the WHOLE task
 * `"partial-failure"`, never `"running"`, matching N-17 exactly: one failed category is
 * enough to withhold completion for the entire deletion, not just that category.
 */
export function deriveLogicalCascadeStatus(
  results: readonly CascadeResultEntry[],
): "running" | "partial-failure" {
  assertSixCascadeKinds(results);
  if (results.some((r) => r.result === "failed")) return "partial-failure";
  return "running"; // pending or all-ok: logically invalidated (or in flight); physical
  // deletion is still ahead either way -- see the file header for why "done" never appears.
}

/** N-17, restated as a predicate: may a receipt be issued for this status? */
export function receiptEligible(status: DeletionTaskStatus): boolean {
  return status === "done";
}

/** logicalInvalidationDeadline = requestedAt + D-15's 5 minutes, taken from the one source. */
export function logicalInvalidationDeadline(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + OA.WITHDRAWAL_SLA_MS.logicalRetire);
}

/**
 * physicalDeletionDeadline = requestedAt + the project's configured grace period.
 *
 * ⚠ NOT `WITHDRAWAL_SLA_MS.physicalDelete` unconditionally: `files.RetentionParams.
 * trashGraceDays` is the O-01 parameter that is "项目级可覆盖" (N-20) -- a project that has
 * overridden its grace period must see ITS number here, not D-15's org-wide default silently
 * winning. `trashGraceDays` defaults to the same 30 days `WITHDRAWAL_SLA_MS.physicalDelete`
 * encodes (see `getRetentionPolicy`'s default), so the two agree until a project overrides
 * one of them -- which is the whole reason the parameter is injectable rather than hardcoded
 * a second time here.
 */
export function physicalDeletionDeadline(requestedAt: Date, trashGraceDays: number): Date {
  const ms = trashGraceDays * 24 * 60 * 60 * 1000;
  return new Date(requestedAt.getTime() + ms);
}

/** V6·22-4: did logical invalidation land inside the ≤5-minute SLA? */
export function withinLogicalSla(requestedAt: Date, completedAt: Date): boolean {
  return completedAt.getTime() - requestedAt.getTime() <= OA.WITHDRAWAL_SLA_MS.logicalRetire;
}
