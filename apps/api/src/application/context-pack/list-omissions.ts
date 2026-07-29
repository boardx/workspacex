/**
 * `ListOmissions` -- the discard list, reviewable (F11 / usecases.md).
 *
 * R11 names this as one of the two steps implementers skip, which is why it is a feature of its
 * own with acceptance of its own. The thing being defended is small and specific: the answer to
 * "why did the AI not read this" must survive filtering, folding and truncation.
 *
 * ⚠ Every narrowing in this operation applies to `omissions` ONLY. `droppedCount` counts the
 * whole list and `complianceAlwaysShown` is computed from the whole list, both in
 * `auditableOmissions`. A reader who filters by `budget` still learns how many things were
 * dropped in total and still sees every compliance discard -- I-4 says those may not disappear
 * behind any view, and a filter is a view.
 */
import type { omissionReason as OR } from "@repo/contracts";
import { auditableOmissions } from "../../domain/context-pack/omission-audit";
import type { ContextPackAuditStore, ListOmissionsOut } from "./ports";

/**
 * `RUN_NOT_FOUND` from the contract's `err` list.
 *
 * A class rather than a string so the interface layer maps it once. It carries no detail about
 * what else exists -- the run id is the only thing the caller named.
 */
export class RunNotFoundError extends Error {
  readonly reason = "RUN_NOT_FOUND" as const;
  constructor(readonly runId: string) {
    super(`no context pack for run "${runId}"`);
  }
}

export interface ListOmissionsInput {
  readonly runId: string;
  readonly reasonFilter?: OR.OmissionReason;
}

export async function listOmissions(
  deps: { readonly store: ContextPackAuditStore },
  input: ListOmissionsInput,
): Promise<ListOmissionsOut> {
  const audit = await deps.store.findAudit(input.runId);
  if (audit === null) throw new RunNotFoundError(input.runId);

  const projected = auditableOmissions({
    all: audit.omissions,
    thresholdUsed: audit.thresholdUsed,
    reasonFilter: input.reasonFilter,
  });

  // Spread into a plain object matching the contract's `out` exactly. The domain type is
  // structurally identical today; writing the fields out means a field added to one side does
  // not travel to the wire unnoticed (the `out` schemas are `.strict()`, so it would be caught,
  // but being caught at the edge is later than being caught here).
  return {
    omissions: [...projected.omissions],
    droppedCount: projected.droppedCount,
    thresholdUsed: projected.thresholdUsed,
    complianceAlwaysShown: [...projected.complianceAlwaysShown],
  };
}
