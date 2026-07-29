/**
 * Ports for the auditable-discard-list side of the bundle (F11).
 *
 * ⚠ Only the READ side is here. `ContextPackStore` in `usecases.md` also persists packs, and
 * F11 deliberately does not define the write half: the storage shape belongs with replay and
 * pinning (F13, `context_packs`), and a store interface written now to satisfy one reader would
 * be guessed twice -- once here and once when the table actually exists. F09 made the same call
 * about not creating a migration it could only guess at.
 */
import type { z } from "zod";
import type { contextPack as CP } from "@repo/contracts";
import type { ContextItem } from "../../domain/context-pack/context-item";
import type { Omission } from "../../domain/context-pack/pack-structure";
import type { OrgId } from "../../domain/org-id";

/** What `listOmissions` needs to answer for one run. Less than a whole pack, on purpose. */
export interface StoredPackAudit {
  readonly runId: string;
  readonly orgId: OrgId;
  readonly items: readonly ContextItem[];
  readonly omissions: readonly Omission[];
  /**
   * The threshold THIS run used -- read back, never recomputed.
   *
   * Recomputing it from `THRESHOLDS` at read time would silently re-answer the question with
   * today's configuration: after a per-task override lands (O-36 allows it), an audit of an old
   * run would report a threshold that run never applied, and every "相关度 0.38 < 0.45" line in
   * the discard list would become a statement about a different assembly.
   */
  readonly thresholdUsed: number;
}

export interface ContextPackAuditStore {
  /** null when the runId is unknown -- the caller raises RUN_NOT_FOUND. */
  findAudit(runId: string): Promise<StoredPackAudit | null>;
}

export const CONTEXT_PACK_AUDIT_STORE = Symbol("ContextPackAuditStore");

export type ListOmissionsOut = z.infer<typeof CP.operations.listOmissions.out>;
