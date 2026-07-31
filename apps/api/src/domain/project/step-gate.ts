/**
 * The two "空转" failure codes `bindToProjectStep` was signed off to throw and could never
 * evaluate (0008-f06-binding-modes.sql:26-30: "there is no `steps` table anywhere in
 * phase-00"). F118 gave a step an entity (`agenda_segments`) and a foreign key; this file is
 * the judgement itself -- pure, so both directions of both codes are assertable without a
 * database:
 *
 *   STEP_CLOSED                the segment is terminal (`closed` or `skipped`) -- binding
 *                               into it must be refused, and binding into a non-terminal
 *                               (`pending` / `active`) segment must NOT be (F120 notes, V4).
 *   STEP_REJECTS_ARTIFACT_TYPE  the segment's whitelist is non-empty and does not contain the
 *                               artifact's source -- and an EMPTY whitelist (the default,
 *                               Q-2③) must accept every source, or the code "works" only in a
 *                               fixture nobody's default state ever reaches (F120 notes, V5).
 *
 * `a check that cannot fail is worse than an absent one, because it reads as coverage`
 * (0008-f06-binding-modes.sql:29-31) is the literal debt this file pays down.
 */
import { artifact as A } from "@repo/contracts";
import { project as P } from "@repo/contracts";
import type { z } from "zod";

export type ArtifactSource = z.infer<typeof A.ArtifactSource>;
export type AgendaSegmentState = z.infer<typeof P.AgendaSegmentState>;

/** The two states a segment is done being in. `mergedInto` may be set on either (Q-2② B). */
const TERMINAL_STATES: ReadonlySet<AgendaSegmentState> = new Set(["closed", "skipped"]);

/** The fields of an `agenda_segments` row the gate needs -- nothing else. */
export interface StepGateSegment {
  readonly state: AgendaSegmentState;
  /** Empty = unrestricted (Q-2③ default). */
  readonly acceptedSources: readonly ArtifactSource[];
}

export type StepGateVerdict = "OK" | "STEP_CLOSED" | "STEP_REJECTS_ARTIFACT_TYPE";

/**
 * Judge a bind against one segment's gate.
 *
 * `STEP_CLOSED` is checked before `STEP_REJECTS_ARTIFACT_TYPE` on purpose: a terminal segment
 * refuses EVERY bind regardless of source, so reporting a source mismatch on a segment that is
 * closed anyway would name the wrong reason.
 */
export function evaluateStepGate(
  segment: StepGateSegment,
  artifactSource: ArtifactSource,
): StepGateVerdict {
  if (TERMINAL_STATES.has(segment.state)) return "STEP_CLOSED";

  // Empty whitelist = accept anything (Q-2③). Written as a length check, not `.includes`
  // short-circuiting on empty, so the "unrestricted" branch is a distinct line a coverage
  // report can point at -- the same technique 0008's IFF constraint uses for the same reason:
  // an accidental `[] .includes(x) === false` reading as "no sources accepted" is exactly the
  // silent-full-reject bug V5's third assertion exists to catch.
  if (segment.acceptedSources.length === 0) return "OK";

  return segment.acceptedSources.includes(artifactSource) ? "OK" : "STEP_REJECTS_ARTIFACT_TYPE";
}
