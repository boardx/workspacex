/**
 * Two failure modes `advanceAgendaSegment` can hit that `ProjectReason` has **no code for**.
 * Same shape as `binding-errors.ts`'s `null` entries: the contract cannot say "not found" or
 * "merge with no target" for this operation, so a code-for-code translation would have to
 * invent one, and inventing a code the contract does not list is a bigger drift than admitting
 * the gap. The interface layer maps both to a plain HTTP status with no `reasonCode` body.
 *
 * ⚠ Not `ProjectError`: that class carries a `z.infer<typeof project.ProjectReason>`, and
 * neither of these is a member of that enum. Giving them one would be exactly the "a check
 * that cannot fail is worse than an absent one" shape the migration header warns about --
 * a reasonCode nobody asked for reads as coverage the contract never signed off on.
 */

/** No `agenda_segments` row for `(workshopId, segmentId, orgId)`. Rendered as 404. */
export class AgendaSegmentNotFoundError extends Error {}

/** `action: "merge"` with `mergeIntoSegmentId: null`. Rendered as 400 -- a shape error, not a
 *  business refusal (the zod schema types the field as nullable regardless of `action`, so
 *  this is the one validation the schema itself cannot express). */
export class MergeTargetRequiredError extends Error {}
