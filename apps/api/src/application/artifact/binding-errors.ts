/**
 * The failures the three binding use cases can produce, and their mapping to the contract.
 *
 * ## Why the mapping is a table and not a `switch` in the controller
 *
 * `usecases.md` says failure modes must be exhaustive because the interface renders its
 * seven states from them. Two of the failures below have NO code in the contract at all --
 * they are states the API as signed cannot express. A `switch` with a `default:` swallows
 * that: the unmapped case becomes a 500, the gate stays green, and nobody learns the
 * contract is short of two members.
 *
 * So the mapping is data, `null` means "the contract has no code for this", and
 * `binding-three-modes.test.ts` asserts the exact set of nulls. When the contract gains
 * those codes, that assertion fails and points at this file -- which is the intended way to
 * find out.
 */
import { artifact as A } from "@repo/contracts";
import type { z } from "zod";

export type ArtifactErrorCode = z.infer<typeof A.ArtifactError>;

/** Base class so the interface layer has exactly one thing to catch. */
export class BindingError extends Error {}

/** `ARTIFACT_NOT_FOUND`. Also the answer for a binding id nobody may see -- V4's 404-not-403. */
export class ArtifactNotFoundError extends BindingError {}

/** `NO_PROJECT_ROLE`. */
export class NoProjectRoleError extends BindingError {}

/** `PROJECT_ROLE_INSUFFICIENT` -- the role exists but may not bind or pin (R5: 组员不可定版). */
export class ProjectRoleInsufficientError extends BindingError {}

/** `CANNOT_DOWNGRADE` (A3 / I-11). Covers re-pointing a pinned binding too -- see below. */
export class CannotDowngradeError extends BindingError {}

/**
 * `mode: "pinned"` with no `sourceVersionId`.
 *
 * ⚠ The contract cannot express this in either direction. `bindToProjectStep.in` declares
 * `sourceVersionId: z.string().optional()` with the requirement written in prose
 * ("pinned 模式必须提供 sourceVersionId") -- so `in.parse({..., mode: "pinned"})` SUCCEEDS,
 * and the schema, whose job is to be the single source, does not carry the rule. And `err`
 * lists no code for the refusal. A `.superRefine` would express it; adding one is a
 * contract amendment, not an implementation decision.
 */
export class PinnedRequiresVersionError extends BindingError {}

/**
 * Binding `live` or upgrading to `pinned` when the artifact has NO version yet.
 *
 * `BackflowEntry.version` is `int().positive()`, so a project-side row for a version-less
 * artifact cannot be built without inventing a number. The three available responses were:
 * return an entry with a fabricated version (a lie the whole feature exists to prevent),
 * omit the row from the list (a `live` binding that is invisible on the project side, which
 * contradicts its own definition), or refuse the bind. This is the refusal.
 *
 * The state is reachable: 0007's own comment calls a version-less artifact "a draft buffer
 * with nothing pinned", so it is a normal state of the model, not a corruption.
 */
export class NoVersionToBindError extends BindingError {}

/**
 * `STEP_CLOSED` (F120 / I-P45) -- the target segment is terminal (`closed` or `skipped`).
 *
 * Phase-00 signed this code off for `bindToProjectStep` and could never evaluate it
 * (0008-f06-binding-modes.sql:26-30: no `steps` table existed). F118 gave a step an entity
 * and a foreign key; this is that judgement's first live throw site.
 */
export class StepClosedError extends BindingError {}

/**
 * `STEP_REJECTS_ARTIFACT_TYPE` (F120 / I-P17) -- the segment's non-empty whitelist does not
 * contain the artifact's source. An EMPTY whitelist accepts everything (Q-2③ default) and
 * never throws this.
 */
export class StepRejectsArtifactTypeError extends BindingError {}

/**
 * `REQUIRES_PINNED` (E1 / AC1 / I-14) -- the downstream citation gate refused (F07).
 *
 * Carries the ARTIFACT id, and that is not decoration: E1 requires the refusal to offer
 * 一键定版, and an interface cannot address an artifact it was never told about. The caller
 * supplied a version id; the artifact behind it is what the remedy acts on.
 *
 * A typed field rather than a message: `lint-error-leak` bans the interface layer from
 * reading `.message` off an exception, and it is right to -- messages here name the ids of
 * whatever the caller was refused. A field is the only way to pass one deliberately.
 */
export class RequiresPinnedError extends BindingError {
  constructor(readonly artifactId: string, message: string) {
    super(message);
  }
}

/**
 * Which contract code each failure maps to. `null` = the contract has no code for it.
 *
 * Keyed by the class, not by a string: a string key can drift from the class name and this
 * cannot.
 */
type BindingErrorCtor = abstract new (...args: never[]) => BindingError;

export const CONTRACT_CODE_BY_ERROR: ReadonlyMap<BindingErrorCtor, ArtifactErrorCode | null> =
  new Map<BindingErrorCtor, ArtifactErrorCode | null>([
  [ArtifactNotFoundError, "ARTIFACT_NOT_FOUND" as const],
  [NoProjectRoleError, "NO_PROJECT_ROLE" as const],
  [ProjectRoleInsufficientError, "PROJECT_ROLE_INSUFFICIENT" as const],
  [CannotDowngradeError, "CANNOT_DOWNGRADE" as const],
  [RequiresPinnedError, "REQUIRES_PINNED" as const],
  [StepClosedError, "STEP_CLOSED" as const],
  [StepRejectsArtifactTypeError, "STEP_REJECTS_ARTIFACT_TYPE" as const],
  [PinnedRequiresVersionError, null],
  [NoVersionToBindError, null],
]);

/** The code for a thrown error, or null when the contract has none. */
export function contractCodeOf(e: BindingError): ArtifactErrorCode | null {
  for (const [ctor, code] of CONTRACT_CODE_BY_ERROR) {
    if (e instanceof ctor) return code;
  }
  return null;
}
