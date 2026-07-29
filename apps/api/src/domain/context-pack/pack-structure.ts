/**
 * The three-section structure: `items[]` / `claims[]` / `omissions[]`.
 *
 * "A Context Pack is not an array of strings" is the first sentence of the contract, and it
 * is a sentence about what can be ASKED of the thing afterwards. A string blob cannot answer
 * "where did this come from", "why was I allowed to see it", or "what did you leave out" --
 * and those three questions are the entire reason this bundle exists.
 *
 * ## What this file checks, and the one rule that is NOT pack-wide
 *
 * "No field may be empty" is an `items[]` rule. It is tempting to generalise it to the whole
 * pack, and doing so would be wrong in a way that quietly deletes evidence:
 * `claims[].contradictingSegmentIds` is legitimately empty for a claim nobody disputes, and
 * a validator that rejected empty arrays there would push implementations towards not
 * emitting such claims at all. The field must be PRESENT (so R7's "opposing evidence is
 * never filtered out" has somewhere to live and cannot be dropped from the shape); its being
 * empty is data, not damage. Same for `supportingSegmentIds`, and same for the three
 * sections themselves -- a pack with zero items is E1's real empty state, which the contract
 * requires to be reported honestly rather than filled in.
 *
 * ## `omissions[].compliance` is checked against the single source, not trusted
 *
 * `Omission` carries both `reason` and `compliance`, and `domain.md` says in as many words
 * that `compliance` is DERIVED from `OMISSION_REASONS[reason].compliance` and "not stored
 * separately". A wire format has to carry it anyway, so the second copy exists on the wire
 * whether anyone likes it or not -- which means the only thing standing between here and the
 * ninth drift is a check that the two agree. `withdrawn` arriving with `compliance: false`
 * would let a compliance discard be folded away behind "showing the first 5", which is
 * precisely what I-4 forbids, and nothing else would notice.
 */
import { contextPack as CP, omissionReason as OR } from "@repo/contracts";
import type { z } from "zod";
import { emptyContextItemFields, isEmptyValue } from "./context-item";

export type ContextPack = z.infer<typeof CP.ContextPack>;
export type ClaimRef = z.infer<typeof CP.ClaimRef>;
export type Omission = z.infer<typeof CP.Omission>;

/** The three sections, read off the contract rather than typed out again. */
export const PACK_SECTIONS = ["items", "claims", "omissions"] as const satisfies readonly (keyof ContextPack)[];

export interface StructureViolation {
  /** Where: `items[2].content`, `omissions[0].compliance`, `claims`. */
  readonly at: string;
  readonly problem: string;
}

/**
 * Every structural violation in the pack, not just the first.
 *
 * All of them, because a caller that fixes one at a time never learns that the item builder
 * is systematically dropping a field -- it looks like five unrelated bugs.
 */
export function packStructureViolations(pack: ContextPack): readonly StructureViolation[] {
  const out: StructureViolation[] = [];

  for (const field of ["packId", "runId"] as const) {
    if (isEmptyValue(pack[field])) {
      out.push({ at: field, problem: "must be non-empty: a pack that cannot be named cannot be replayed (I-5)" });
    }
  }

  // The sections must EXIST as arrays. Empty is legal (E1); absent is not -- an assembler
  // that omits `omissions` entirely has silently reverted to a black box (I-2's premise).
  for (const section of PACK_SECTIONS) {
    if (!Array.isArray(pack[section])) {
      out.push({ at: section, problem: "the three-section structure requires this array to be present (may be empty)" });
    }
  }

  (pack.items ?? []).forEach((item, i) => {
    for (const field of emptyContextItemFields(item)) {
      out.push({
        at: `items[${i}].${field}`,
        problem:
          field === "anchor"
            ? "no anchor field is set -- an item that cannot get back to the original is not citable (I-1, ANCHOR_MISSING)"
            : "empty -- I-1 requires every ContextItem field to be non-empty",
      });
    }
  });

  (pack.claims ?? []).forEach((claim, i) => {
    if (isEmptyValue(claim.statement)) {
      out.push({ at: `claims[${i}].statement`, problem: "empty: a claim that states nothing cannot be reviewed" });
    }
    // Present, not non-empty. See the header -- this is the structural half of I-12.
    for (const field of ["supportingSegmentIds", "contradictingSegmentIds"] as const) {
      if (!Array.isArray(claim[field])) {
        out.push({
          at: `claims[${i}].${field}`,
          problem: "must be present as an array (empty is legal); dropping the field is how opposing evidence disappears (R7 / I-12)",
        });
      }
    }
  });

  (pack.omissions ?? []).forEach((om, i) => {
    if (isEmptyValue(om.ref)) {
      out.push({ at: `omissions[${i}].ref`, problem: "empty: an omission that names nothing explains nothing (I-2)" });
    }
    if (isEmptyValue(om.explain)) {
      out.push({ at: `omissions[${i}].explain`, problem: "empty: the discard list is for the person asking why, not a log" });
    }
    const known = (OR.OMISSION_REASON_KEYS as readonly string[]).includes(om.reason);
    if (!known) {
      out.push({ at: `omissions[${i}].reason`, problem: `"${om.reason}" is outside the closed reason set (D-U4, I-3)` });
      return;
    }
    const derived = OR.isComplianceOmission(om.reason);
    if (om.compliance !== derived) {
      out.push({
        at: `omissions[${i}].compliance`,
        problem:
          `says ${om.compliance} but OMISSION_REASONS["${om.reason}"].compliance is ${derived} -- ` +
          `compliance is derived from the reason, and a compliance discard marked false can be folded away (I-3/I-4)`,
      });
    }
  });

  return out;
}

export function isWellFormedPack(pack: ContextPack): boolean {
  return packStructureViolations(pack).length === 0;
}

export class MalformedContextPackError extends Error {
  constructor(readonly violations: readonly StructureViolation[]) {
    super(`context pack is malformed:\n${violations.map((v) => `  ${v.at}: ${v.problem}`).join("\n")}`);
  }
}

/**
 * Parse-then-check: the schema first, the emptiness rules second.
 *
 * Both, in that order, because they catch different things and each one alone reports
 * success on the other's failures. `CP.ContextPack.parse` catches a missing field or a wrong
 * type; it accepts a fully blank item. `packStructureViolations` catches the blank item; it
 * cannot run at all on something whose shape is wrong.
 */
export function parseContextPack(value: unknown): ContextPack {
  const pack = CP.ContextPack.parse(value);
  const violations = packStructureViolations(pack);
  if (violations.length > 0) throw new MalformedContextPackError(violations);
  return pack;
}
