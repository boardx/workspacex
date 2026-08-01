/**
 * F05 -- temporary read elevation that expires with the agenda segment it was granted for
 * (UC-1.4 R4: "临时提权按议程环节自动失效").
 *
 * ## What this is layered ON TOP OF, and why it is not a fifth project role
 *
 * `project-role-matrix.ts` is the closed, static table of what each of the four project
 * roles may do. A temporary grant is explicitly NOT a change to that table and not a role
 * swap (same distinction `authorize-project-write.ts` draws for preview mode) -- it is a
 * narrow, time-boxed ADDITION on top of whatever role the grantee already holds ("观察者+
 * 第2组原始内容临时读权", `feature_list.json` F05 / F127 notes: "提权是在既有项目角色之上
 * 追加，不是换一个角色"). So this module never touches `PROJECT_ROLE_MATRIX` and never
 * asks "what role is this" -- it only asks "is there a still-live grant covering this one
 * extra action".
 *
 * ## Why expiry is judged against agenda segment STATE, not a wall-clock deadline
 *
 * The acceptance criteria are explicit that the failure condition is a STATE MACHINE
 * TRANSITION, not a point in time (`feature_list.json` F127 notes, verbatim: "失效条件是
 * 流程节点不是时间点"). A grant names the `agendaSegmentId` it rides on; it stays valid for
 * as long as that segment is the one currently `active`, and becomes invalid the instant
 * the segment leaves that state -- by ANY of the four terminal outcomes `advanceAgendaSegment`
 * recognises (`advance-segment-outcomes.ts`: advance/closeEarly/merge all land on `closed`,
 * `skip` lands on `skipped`). Re-deriving those two terminal states here (rather than
 * importing `isTerminalState` from `domain/project/advance-segment-outcomes.ts`) is
 * deliberate: `identity` sits inward of `project` in this onion (`advance-agenda-segment.ts`
 * already imports `authorize` FROM identity), so importing the other direction would be a
 * layering violation for the sake of not repeating four literal state names. Both places are
 * checked against the exhaustive `AgendaSegmentState` union so a fifth state cannot silently
 * fall through either one uncovered.
 */

/** Mirrors `AgendaSegmentRow.state` (`application/project/ports.ts`) -- see file header for
 *  why this is a local, independently-exhaustive copy rather than a cross-bundle import. */
export type AgendaSegmentStateForGrant = "pending" | "active" | "closed" | "skipped";

const TERMINAL_STATES: readonly AgendaSegmentStateForGrant[] = ["closed", "skipped"];

/** A segment is done (by any of the four outcomes) once it is no longer `pending`/`active`. */
export function isSegmentTerminalForGrant(state: AgendaSegmentStateForGrant): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * The narrow extra capability being granted: one read action, optionally scoped to one
 * group (mirrors `read.ownGroup`'s shape -- "第2组" in the acceptance example is a group
 * scope, not a different action). `null` groupId = the grant covers the action for every
 * group (e.g. `read.rawTranscript` project-wide), matching how `visibleBlocksFor` has no
 * per-group notion either.
 */
export interface TemporaryGrantScope {
  readonly action: string;
  readonly groupId: string | null;
}

export interface TemporaryGrant {
  readonly id: string;
  readonly orgId: string;
  readonly workshopId: string;
  readonly granterId: string;
  readonly granteeId: string;
  readonly scope: TemporaryGrantScope;
  /** The segment whose termination (by any of the four outcomes) ends this grant. */
  readonly agendaSegmentId: string;
  readonly createdAt: string;
  /** null while live. Set exactly once, the first time expiry is OBSERVED (see
   *  `check-temporary-grant-access.ts` for why detection, not a background sweep, sets it). */
  readonly revokedAt: string | null;
  readonly revokedReason: TemporaryGrantRevokedReason | null;
}

export type TemporaryGrantRevokedReason = "agenda-segment-terminal";

export type TemporaryGrantVerdict =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: "ALREADY_REVOKED" | "SEGMENT_TERMINAL" | "SEGMENT_NOT_FOUND" };

/**
 * Pure judgement: given a grant row and the CURRENT state of the segment it named, is it
 * still live? No I/O, no clock -- the caller supplies both facts so this stays as
 * exhaustively testable as `decide()` in `permission-decision.ts`.
 */
export function evaluateTemporaryGrant(
  grant: Pick<TemporaryGrant, "revokedAt">,
  segmentState: AgendaSegmentStateForGrant | null,
): TemporaryGrantVerdict {
  if (grant.revokedAt !== null) return { valid: false, reason: "ALREADY_REVOKED" };
  if (segmentState === null) return { valid: false, reason: "SEGMENT_NOT_FOUND" };
  if (isSegmentTerminalForGrant(segmentState)) return { valid: false, reason: "SEGMENT_TERMINAL" };
  return { valid: true };
}

const scopeKey = (s: TemporaryGrantScope): string => `${s.action}:${s.groupId ?? "*"}`;

/** Does this grant cover the requested action/group? Group-scoped grants only cover their
 *  own group; a `null`-group grant covers every group, including a `null` request. */
export function grantCovers(grant: Pick<TemporaryGrant, "scope">, requested: TemporaryGrantScope): boolean {
  if (grant.scope.action !== requested.action) return false;
  if (grant.scope.groupId === null) return true;
  return grant.scope.groupId === requested.groupId;
}

export const temporaryGrantScopeKey = scopeKey;
