/**
 * The single choke point every project WRITE endpoint must call through while a preview is
 * active (F04, UC-1.4 R4-A1 / I-30 second bullet).
 *
 * ## Why preview blocks ALL writes, not just writes the previewed role couldn't do anyway
 *
 * The naive reading of "预览态下不得以被预览角色的身份写入" is "cap the actor's writes at
 * the previewed role's ceiling" -- so a facilitator previewing as `observer` would still be
 * allowed to `agendaSegment.advance` (something only a facilitator can do), because that write isn't
 * "as the observer", it's the facilitator acting for real.
 *
 * The contract note (`packages/contracts/src/org-admin.ts`, `previewAsRole`) is stricter than
 * that: "预览态下全部写端点返回 PROJECT_ROLE_INSUFFICIENT". Preview is an OBSERVATION mode,
 * not a role swap with a ceiling -- while it is active, writing is suspended categorically.
 * The reason this has to be the rule, not merely a plausible one: no write endpoint given
 * only `previewing: true` and the real actor's identity can tell "the facilitator, writing
 * for real, who also happens to be mid-preview" apart from "the facilitator, writing AS the
 * previewed role" -- the two look identical from inside the request. A ceiling-based gate
 * would have to solve that disambiguation to be safe; a categorical gate does not need to.
 * The UI's "exit preview" affordance (`previewAsRole.out.exitTo`) is how a facilitator
 * resumes writing: leave the mode, not "write anyway because it's really me".
 *
 * ## Why this denies BEFORE calling `authorize()`, not after
 *
 * `authorize()` reads project + org membership from the repository. If preview denied only
 * after that read, a repository outage during a preview session would surface as
 * `AUTH_SERVICE_UNAVAILABLE` instead of the categorical `PROJECT_ROLE_INSUFFICIENT` -- an
 * unrelated failure mode leaking into a decision that was already made. Short-circuiting
 * means the preview denial never depends on the auth store being reachable.
 */
import { authorize, type AuthorizeDeps, type AuthorizeInput } from "./authorize";
import type { PermissionDecision } from "../../domain/identity/permission-decision";

export interface AuthorizeProjectWriteInput extends AuthorizeInput {
  /** True while the caller's session is in role-preview mode (`PreviewAsRole`). */
  readonly previewing: boolean;
}

/**
 * `orgLayer.role` / `projectLayer` are left `null` deliberately: a preview denial is not a
 * claim about the actor's real org or project role (which may well be perfectly sufficient)
 * -- it is a claim about the MODE the request was made in. Populating them from the real
 * membership would invite a caller to read "orgLayer.role: 'lead'" as "so why was this
 * denied", when the answer has nothing to do with that field.
 */
function previewWriteDenial(decisionId: string): PermissionDecision {
  return {
    allowed: false,
    orgLayer: { role: null, teamId: null, passed: false },
    projectLayer: null,
    scopeLayer: { scope: "org-wide", passed: false },
    reasonCode: "PROJECT_ROLE_INSUFFICIENT",
    decisionId,
  };
}

export async function authorizeProjectWrite(
  deps: AuthorizeDeps,
  input: AuthorizeProjectWriteInput,
): Promise<PermissionDecision> {
  if (input.previewing) {
    return previewWriteDenial(deps.ids.next());
  }
  return authorize(deps, input);
}
