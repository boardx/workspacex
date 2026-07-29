/**
 * "被丢弃不等于不存在", made checkable (I-2 / I-3 / I-4 -- F11).
 *
 * `domain.md` calls I-2 the soul of this bundle: every candidate that did not become an item must
 * be findable in `omissions[]` with a reason. The failure mode is not a wrong reason, it is
 * SILENCE -- a filter that returns survivors and forgets the rest, at which point "why did the AI
 * not read this" becomes unanswerable and the Pack is a black box again.
 *
 * Silence cannot be detected by looking at the result: a pack with 3 items and 0 omissions looks
 * exactly like a pack where nothing was dropped. It is only detectable against the CANDIDATE SET,
 * which is why `omissionClosure` takes it as an argument and why callers have to keep it.
 */
import { omissionReason as OR } from "@repo/contracts";
import type { Omission } from "./pack-structure";

export interface ClosureReport {
  /** In the candidate set, not in `items[]`, and not explained. I-2's violation. */
  readonly unexplained: readonly string[];
  /**
   * Explained AND present in `items[]`.
   *
   * The opposite failure, and it is not harmless: it tells a reader something was withheld while
   * the same evidence is sitting in the pack being cited. Discovered by the same set algebra, so
   * there is no reason not to report it.
   */
  readonly contradictory: readonly string[];
  /** Named in `omissions[]` but never a candidate -- an explanation for something nobody asked. */
  readonly phantom: readonly string[];
  readonly closed: boolean;
}

export function omissionClosure(input: {
  readonly candidateIds: readonly string[];
  readonly itemIds: readonly string[];
  readonly omissions: readonly Omission[];
}): ClosureReport {
  const items = new Set(input.itemIds);
  const explained = new Set(input.omissions.map((o) => o.ref));
  const candidates = new Set(input.candidateIds);

  const unexplained = [...candidates].filter((id) => !items.has(id) && !explained.has(id));
  const contradictory = [...explained].filter((id) => items.has(id));
  const phantom = [...explained].filter((id) => !candidates.has(id));

  return {
    unexplained,
    contradictory,
    phantom,
    closed: unexplained.length === 0 && contradictory.length === 0 && phantom.length === 0,
  };
}

export class OmissionClosureError extends Error {
  constructor(readonly report: ClosureReport) {
    super(
      `the discard list does not close over the candidate set (I-2):\n` +
        (report.unexplained.length > 0
          ? `  never explained (dropped in silence): ${report.unexplained.join(", ")}\n`
          : "") +
        (report.contradictory.length > 0
          ? `  explained as discarded but present in items[]: ${report.contradictory.join(", ")}\n`
          : "") +
        (report.phantom.length > 0
          ? `  explained but never a candidate: ${report.phantom.join(", ")}\n`
          : ""),
    );
  }
}

export function assertOmissionClosure(input: {
  readonly candidateIds: readonly string[];
  readonly itemIds: readonly string[];
  readonly omissions: readonly Omission[];
}): void {
  const report = omissionClosure(input);
  if (!report.closed) throw new OmissionClosureError(report);
}

/**
 * I-3 as a predicate: the reason set is CLOSED, and the property to hold is closure -- not a
 * member count.
 *
 * ⚠ Deliberately not `keys.length === 8`. The enum grew from 7 to 8 through ADR-021, which is the
 * reviewed way it is supposed to grow; a length assertion would have failed that legitimate
 * addition and taught whoever hit it to edit the test rather than think (contract-design hard
 * rule 7). What must not happen is a value from outside getting in.
 */
export function isKnownOmissionReason(reason: string): boolean {
  return (OR.OMISSION_REASON_KEYS as readonly string[]).includes(reason);
}

/** Every omission whose reason is outside the closed enum. Empty is the invariant. */
export function outOfEnumOmissions(omissions: readonly Omission[]): readonly Omission[] {
  return omissions.filter((o) => !isKnownOmissionReason(o.reason));
}

export interface AuditableOmissions {
  readonly omissions: readonly Omission[];
  readonly droppedCount: number;
  readonly thresholdUsed: number;
  /**
   * ⚠ Computed from the FULL list every time, and never from `omissions` after filtering.
   *
   * I-4: compliance discards (withdrawn / expired / unauthorized) stay visible under any fold,
   * truncation, pagination or filter. The one-line version of this bug is
   * `complianceAlwaysShown: omissions.filter(isCompliance)` placed after the reasonFilter has
   * already been applied -- which is green in every happy-path test and drops precisely the rows
   * the invariant is about.
   */
  readonly complianceAlwaysShown: readonly Omission[];
}

/**
 * The `listOmissions` projection (F11 / usecases.md `ListOmissions`).
 *
 * `droppedCount` counts the WHOLE discard list, not the filtered view: it answers "how much did
 * you not show me", and a count that shrinks with the filter answers nothing.
 */
export function auditableOmissions(input: {
  readonly all: readonly Omission[];
  readonly thresholdUsed: number;
  readonly reasonFilter?: OR.OmissionReason;
}): AuditableOmissions {
  const all = input.all;
  const filtered = input.reasonFilter === undefined ? all : all.filter((o) => o.reason === input.reasonFilter);
  return {
    omissions: filtered,
    droppedCount: all.length,
    thresholdUsed: input.thresholdUsed,
    complianceAlwaysShown: all.filter((o) => OR.isComplianceOmission(o.reason)),
  };
}
