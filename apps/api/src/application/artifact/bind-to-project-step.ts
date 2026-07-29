/**
 * `bindToProjectStep` -- attach a Studio product to a project step in one of three modes
 * (uc-0-1 R3 steps 2-4, R4 A1-A4).
 *
 * ## What the three modes actually differ in
 *
 * Not labels. Each one produces a different row and a different project-side consequence:
 *
 *   draft   a row that exists, belongs to its author, and is listed to NOBODY -- not the
 *           author, not the project admin, not the org admin (I-12). Stored rather than
 *           skipped: see below.
 *   live    a row with no version, which the backflow list resolves against the artifact's
 *           head at read time. The source moving IS the behaviour.
 *   pinned  a row frozen to one `artifact_version`. The source moving must not reach it --
 *           that is I-8's binding half, which F05 left here.
 *
 * ## Why `draft` stores a row, although `usecases.md` says it produces none
 *
 * The contract says `draft → 不产生项目侧绑定行` and, in the same document, types this
 * operation's `out` as `Binding` -- an object with an `id`. Those cannot both hold: with no
 * row there is no id, and returning a fabricated one would hand the caller a reference to
 * nothing.
 *
 * Resolved by storing the row and making it invisible on the project side, which is what
 * "不产生项目侧绑定行" is observably about, and reported rather than silently chosen. It is
 * also the only version of I-12 that can be asserted in both directions: with no row at all,
 * "the administrator cannot see the author's draft" is satisfied by a system that stored
 * nothing, and that is the assertion shape this project has recorded nine times.
 *
 * ## This operation also PUBLISHES a draft
 *
 * `usecases.md` has no `draft → live` operation: `upgradeBinding` produces `pinned` and
 * nothing else. So the only home for "publish my draft to the project side" is here, as a
 * re-bind of an existing binding at a higher mode. The database (0008) refuses any re-bind
 * that is not a raise, so this cannot become a downgrade path.
 *
 * ⚠ And that is where a contract gap sits: the reachable downgrade is `bindToProjectStep`
 * (re-bind a pinned binding as live), and its `err` list does NOT contain
 * `CANNOT_DOWNGRADE`. The code exists only on `upgradeBinding`, whose input has no mode and
 * therefore cannot downgrade anything. The refusal is implemented; the contract cannot name
 * it. Asserted in `mode-upgrade-no-downgrade.test.ts` so fixing the contract turns the
 * assertion red.
 */
import {
  classifyTransition,
  isAllowedTransition,
  requiresPinnedVersion,
  type BindingModeName,
} from "../../domain/artifact/binding-modes";
import type { OrgId } from "../../domain/org-id";
import { authorize } from "../identity/authorize";
import type { BindingDeps, BindingRecord, StoredBinding } from "./binding-ports";
import {
  ArtifactNotFoundError,
  CannotDowngradeError,
  NoProjectRoleError,
  NoVersionToBindError,
  PinnedRequiresVersionError,
  ProjectRoleInsufficientError,
} from "./binding-errors";

/**
 * The project action a bind requires.
 *
 * Reused from the signed identity matrix rather than invented. `group.submitOutput`
 * (提交本组产出) is held by `facilitator` and `groupLead` and withheld from `member` and
 * `observer` -- which is exactly uc-0-1 R5's split (引导师/项目经理/研究员/组长 may bind and
 * pin; 组员 不可定版; 观察者 read-only). A new action id would amend a bundle that is already
 * signed, and the amendment would be indistinguishable from the matrix drifting.
 */
export const BIND_ACTION = "group.submitOutput";

export interface BindToProjectStepInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly artifactId: string;
  readonly projectId: string;
  readonly stepId: string;
  readonly mode: BindingModeName;
  /** Required when `mode` is `pinned`; the contract's schema does not say so -- see errors. */
  readonly sourceVersionId?: string;
}

export async function bindToProjectStep(
  deps: BindingDeps,
  input: BindToProjectStepInput,
): Promise<BindingRecord> {
  const { bindings, artifacts, auth, ids } = deps;
  const { userId, orgId, artifactId, projectId, stepId, mode } = input;

  // Permission BEFORE existence. A caller with no role in the project must not be able to
  // learn whether an artifact id exists by comparing two refusals -- the same rule
  // `decideContentRead` follows, for the same reason.
  const decision = await authorize(auth, {
    userId,
    orgId,
    projectId,
    object: { kind: "project", id: projectId },
    action: BIND_ACTION,
  });
  if (!decision.allowed) {
    throw decision.reasonCode === "PROJECT_ROLE_INSUFFICIENT"
      ? new ProjectRoleInsufficientError(`${userId} may not bind in ${projectId}`)
      : new NoProjectRoleError(`${userId} has no usable role in ${projectId}`);
  }

  if (!(await bindings.artifactExists(orgId, artifactId))) {
    throw new ArtifactNotFoundError(`artifact ${artifactId} not found`);
  }

  const pinnedVersionId = await resolvePinnedVersion(deps, input);

  const existing = await bindings.findByStep(orgId, artifactId, projectId, stepId);
  if (existing === null) {
    const id = ids.next("bind");
    await bindings.create({
      id, orgId, artifactId, projectId, stepId, mode, pinnedVersionId, createdBy: userId,
    });
    return { id, artifactId, projectId, stepId, mode, pinnedVersionId };
  }

  return raiseExisting(deps, orgId, existing, mode, pinnedVersionId);
}

/**
 * Which version, if any, this binding freezes to.
 *
 * `live` is checked for a head as well, and that is not symmetry for its own sake: a live
 * binding on an artifact with no version cannot be rendered as a `BackflowEntry` at all
 * (`version` is `positive()`), so allowing it would create a row whose only possible
 * project-side representation is a fabricated one.
 */
async function resolvePinnedVersion(
  deps: BindingDeps,
  input: BindToProjectStepInput,
): Promise<string | null> {
  const { artifacts } = deps;
  const { orgId, artifactId, mode, sourceVersionId } = input;

  if (!requiresPinnedVersion(mode)) {
    if (mode === "live" && (await artifacts.headVersionNumber(orgId, artifactId)) === 0) {
      throw new NoVersionToBindError(
        `artifact ${artifactId} has no version, so a live binding has no version to display`,
      );
    }
    // Not merely ignored -- refused. A `sourceVersionId` alongside `mode: "live"` means the
    // caller believes it is pinning; storing it would violate the IFF in 0008 anyway, and
    // dropping it silently would confirm the caller's belief.
    if (sourceVersionId !== undefined) {
      throw new PinnedRequiresVersionError(
        `mode "${mode}" does not freeze to a version, but sourceVersionId was supplied`,
      );
    }
    return null;
  }

  if (sourceVersionId === undefined) {
    throw new PinnedRequiresVersionError("mode \"pinned\" requires sourceVersionId");
  }
  // Must be a version OF THIS ARTIFACT. 0008 has a trigger for the same rule; this check
  // exists so the caller is told which of its two ids was wrong instead of receiving a
  // constraint name. Reported as not-found rather than as a distinct code: from outside,
  // "that version is not yours" must be indistinguishable from "no such version".
  const version = await artifacts.findVersion(orgId, sourceVersionId);
  if (version === null || version.artifactId !== artifactId) {
    throw new ArtifactNotFoundError(
      `version ${sourceVersionId} is not a version of artifact ${artifactId}`,
    );
  }
  return sourceVersionId;
}

/** Raise an existing binding, or refuse the transition (A2 / A3 / I-8 / I-11). */
async function raiseExisting(
  deps: BindingDeps,
  orgId: OrgId,
  existing: StoredBinding,
  mode: BindingModeName,
  pinnedVersionId: string | null,
): Promise<BindingRecord> {
  const transition = {
    from: existing.mode as BindingModeName,
    to: mode,
    fromVersionId: existing.pinnedVersionId,
    toVersionId: pinnedVersionId,
  };
  if (!isAllowedTransition(transition)) {
    throw new CannotDowngradeError(
      `binding ${existing.id} is ${existing.mode} and cannot become ${mode} (${classifyTransition(transition)})`,
    );
  }
  await deps.bindings.raiseMode(orgId, existing.id, mode, pinnedVersionId);
  return {
    id: existing.id,
    artifactId: existing.artifactId,
    projectId: existing.projectId,
    stepId: existing.stepId,
    mode,
    pinnedVersionId,
  };
}
