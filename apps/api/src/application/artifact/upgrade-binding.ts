/**
 * `upgradeBinding` -- freeze a live (or draft) binding into a fixed snapshot (uc-0-1 A2/A3).
 *
 * ## What "upgrade" freezes to, and why it is not a new version
 *
 * R4 A2's prose says 升级即生成新的不可变版本 -- upgrading MINTS a version. The signed
 * contract cannot do that: `upgradeBinding.in` is `{ bindingId, expectedHeadVersion }` and
 * carries no content, so there is nothing to hash, store or materialize. That is the same
 * wall F04 met at `saveDraft` and F05 met at `pinVersion` (coherence D-2), and it is
 * answered the same way -- no body shape is invented here.
 *
 * So this implements the only reading the contract can carry: the binding freezes to the
 * version the caller declared it was looking at (`expectedHeadVersion`), which already
 * exists. That is also the better behaviour: minting a version on upgrade would pin bytes
 * the person pressing 定版 has never seen, while freezing at the declared head pins exactly
 * what was on their screen. The divergence from the prose is reported, not resolved by
 * guessing.
 *
 * `expectedHeadVersion` therefore does real work rather than being decorative -- the same
 * defect F05 found in `pinVersion`: if the head has moved, the caller is freezing something
 * else, and gets `VERSION_CHANGED` (E4/V6) instead of a snapshot they did not choose.
 *
 * ## Upgrading something already pinned
 *
 * Refused. `CANNOT_DOWNGRADE` is the only code in this operation's `err` list that could
 * apply, and it applies badly: re-pointing a pinned binding at a newer version is not a
 * downgrade in any ordinary sense, it is a citation quietly moving. The refusal is right
 * (I-8: the source moving does not move the binding); the code's NAME does not describe it,
 * and there is no other reachable route to `CANNOT_DOWNGRADE` from this operation at all --
 * its input has no mode. Reported as a contract defect.
 */
import { classifyTransition, isAllowedTransition } from "../../domain/artifact/binding-modes";
import type { OrgId } from "../../domain/org-id";
import { authorize } from "../identity/authorize";
import { VersionChangedError } from "./pin-version";
import { BIND_ACTION } from "./bind-to-project-step";
import type { BindingDeps, BindingRecord } from "./binding-ports";
import {
  ArtifactNotFoundError,
  CannotDowngradeError,
  NoProjectRoleError,
  NoVersionToBindError,
  ProjectRoleInsufficientError,
} from "./binding-errors";

export interface UpgradeBindingInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly bindingId: string;
  /** The head the caller believes it is freezing. 0 means "no version yet", as in pinVersion. */
  readonly expectedHeadVersion: number;
}

export async function upgradeBinding(
  deps: BindingDeps,
  input: UpgradeBindingInput,
): Promise<BindingRecord> {
  const { bindings, artifacts, auth } = deps;
  const { userId, orgId, bindingId, expectedHeadVersion } = input;

  const existing = await bindings.findById(orgId, bindingId);
  // Not-found before the permission check here, unlike `bindToProjectStep`, because there is
  // no project to check a role against until the binding is read. The order is safe in this
  // direction: a binding id is not guessable from outside, and RLS already makes another
  // tenant's binding not-found rather than forbidden.
  if (existing === null) {
    throw new ArtifactNotFoundError(`binding ${bindingId} not found`);
  }

  const decision = await authorize(auth, {
    userId,
    orgId,
    projectId: existing.projectId,
    object: { kind: "project", id: existing.projectId },
    action: BIND_ACTION,
  });
  if (!decision.allowed) {
    throw decision.reasonCode === "PROJECT_ROLE_INSUFFICIENT"
      ? new ProjectRoleInsufficientError(`${userId} may not pin in ${existing.projectId}`)
      : new NoProjectRoleError(`${userId} has no usable role in ${existing.projectId}`);
  }

  // Optimistic concurrency BEFORE the transition rule, so a stale client upgrading a live
  // binding is told the version moved rather than being silently frozen at a head it never
  // saw. Checked even when the transition will be refused anyway -- the two answers are
  // different facts and reporting only the first one hides the other.
  const head = await artifacts.headVersionNumber(orgId, existing.artifactId);
  if (head !== expectedHeadVersion) {
    throw new VersionChangedError(existing.artifactId, expectedHeadVersion, head);
  }
  if (head === 0) {
    throw new NoVersionToBindError(
      `artifact ${existing.artifactId} has no version, so there is nothing to freeze`,
    );
  }

  const versionId = await bindings.findVersionIdByNumber(orgId, existing.artifactId, head);
  if (versionId === null) {
    // The head number came from the same table a moment ago, so this is a concurrent tenant
    // teardown or a genuine fault -- never a normal state. Reported as a version change
    // rather than as not-found: retrying is the correct next step for the caller.
    throw new VersionChangedError(existing.artifactId, expectedHeadVersion, null);
  }

  const transition = {
    from: existing.mode,
    to: "pinned" as const,
    fromVersionId: existing.pinnedVersionId,
    toVersionId: versionId,
  };
  if (!isAllowedTransition(transition)) {
    throw new CannotDowngradeError(
      `binding ${bindingId} is ${existing.mode} and cannot be upgraded (${classifyTransition(transition)})`,
    );
  }

  await bindings.raiseMode(orgId, bindingId, "pinned", versionId);
  return {
    id: existing.id,
    artifactId: existing.artifactId,
    projectId: existing.projectId,
    stepId: existing.stepId,
    mode: "pinned",
    pinnedVersionId: versionId,
  };
}
