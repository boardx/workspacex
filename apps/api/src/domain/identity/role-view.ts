/**
 * F04 -- the four-viewpoint projection: one screen, clipped by project role (UC-1.4 R3/R5/R8).
 *
 * ## Why this is a thin derivation over `PROJECT_ROLE_MATRIX`, not a second table
 *
 * `project-role-matrix.ts` already lists, per role, every action a role may take -- both
 * reads (`read.*`) and writes (everything else). F04's contract (`renderRoleView`) wants two
 * SEPARATE lists: `visibleBlocks` (what content shows) and `actionEndpoints` (what buttons
 * render). Those are exactly the read/write split of the same matrix. Writing a second,
 * hand-maintained role -> blocks/buttons table here would be the same fact declared twice --
 * the failure mode this project has hit repeatedly (see AGENTS.md). So both lists are
 * DERIVED from `PROJECT_ROLE_MATRIX`; nothing here restates which role may do what.
 *
 * ## Why `actionEndpointsFor("observer")` is `[]` while the matrix's observer row is not
 *
 * The matrix's observer row is `["read.published"]` -- not empty, because observers ARE
 * allowed one read. AC3 ("观察者按钮集为空集") is a claim about BUTTONS (write affordances),
 * not about the role's entire action set. Filtering to non-`read.*` actions is what turns
 * "one read action" into "zero buttons" without those two true statements contradicting one
 * another.
 */
import { PROJECT_ROLE_MATRIX, type ProjectAction } from "./project-role-matrix";
import type { ProjectRole } from "./roles";

/** The single screen every project role renders -- AC1: same skeleton, different clipping. */
export const PROJECT_WORKBENCH_SCREEN = "project-workbench";

export interface RoleViewSkeleton {
  readonly screen: string;
  readonly slots: readonly string[];
}

/**
 * Slot names are structural (which regions of the workbench exist), not content -- the
 * clipping happens in `visibleBlocks` / `actionEndpoints`, never by varying the skeleton
 * itself. Varying the skeleton per role would violate AC1 by construction.
 */
const WORKBENCH_SLOTS = ["overview", "agenda", "groups", "audit"] as const;

export function skeletonFor(screen: string): RoleViewSkeleton {
  return { screen, slots: WORKBENCH_SLOTS };
}

const isReadAction = (a: ProjectAction): boolean => a.startsWith("read.");

/**
 * Content blocks this role may see. A WHITELIST, deliberately -- not a fixed-shape object
 * with per-block booleans. AC2 requires that over-privileged fields be ABSENT from the
 * response body, not merely false; an array can only ever name what is present, so there is
 * no key here for a caller to find set to `false`.
 */
export function visibleBlocksFor(role: ProjectRole): readonly string[] {
  return PROJECT_ROLE_MATRIX[role].filter(isReadAction);
}

/**
 * Buttons this role may press. Same whitelist reasoning as `visibleBlocksFor`. This is the
 * literal AC3 assertion surface: `actionEndpointsFor("facilitator")` is a superset of
 * `actionEndpointsFor("groupLead")`, which is a proper superset of
 * `actionEndpointsFor("member")`, which is a proper superset of the empty
 * `actionEndpointsFor("observer")`.
 */
export function actionEndpointsFor(role: ProjectRole): readonly string[] {
  return PROJECT_ROLE_MATRIX[role].filter((a) => !isReadAction(a));
}

/**
 * The action `renderRoleView` and `previewAsRole` judge through `authorize()` to learn
 * "does this requester have ANY project role at all". Deliberately the weakest read action
 * in the matrix -- the one row every project role holds, including `observer`. Using a
 * stronger action would make `NO_PROJECT_ROLE` indistinguishable from "observer denied this
 * particular action", which is exactly the ambiguity V10 requires the caller NOT have.
 */
export const ROLE_VIEW_GATE_ACTION = "read.published";
