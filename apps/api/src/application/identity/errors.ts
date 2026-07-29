/**
 * Errors shared by the identity use cases.
 *
 * `NoOrgMembershipError` used to live in `switch-organization.ts`, which was fine until
 * `switch-organization` needed `list-capabilities` (F15: switching organizations returns the
 * new organization's whole configuration) and `list-capabilities` needed the error. Two
 * modules importing each other is a cycle that happens to work; moving the shared piece to a
 * leaf is the version that keeps working.
 *
 * Re-exported from `switch-organization` so existing importers are unaffected -- a re-export
 * is one declaration seen from two places, not two declarations.
 */
export class NoOrgMembershipError extends Error {
  readonly code = "NO_ORG_MEMBERSHIP";
  constructor() {
    // No org id in the message: whether that org exists is not this caller's business.
    super("NO_ORG_MEMBERSHIP");
  }
}

/* ─────────────────────────── F16: the personal-local organization ─────────────────────────── */

/**
 * The four failures of the local-org path, one class each.
 *
 * ⚠ They are separate classes rather than one `LocalOrgError(code)` because each maps to a
 * DIFFERENT thing the user must do, and collapsing them is how "AI 调用失败了，换个模型试试"
 * gets rendered -- which is the exact advice that would break the promise. The contract lists
 * them separately for the same reason (`invokeLocalModel.err`).
 */
export class LocalOrgOnlyError extends Error {
  readonly code = "LOCAL_ORG_ONLY";
  constructor() {
    super("LOCAL_ORG_ONLY");
  }
}

export class CapabilityNotFoundError extends Error {
  readonly code = "CAPABILITY_NOT_FOUND";
  constructor() {
    super("CAPABILITY_NOT_FOUND");
  }
}

/**
 * The named model is not on this machine.
 *
 * ⚠ Raised INSTEAD of quietly picking a local model that would have worked. Substituting
 * would keep the promise (nothing leaves) while breaking a different one: the user would
 * believe an answer came from the model they chose. Refusing is the only outcome in which
 * both statements stay true.
 */
export class CloudModelForbiddenError extends Error {
  readonly code = "CLOUD_MODEL_FORBIDDEN";
  constructor(readonly endpoint: string | null) {
    super("CLOUD_MODEL_FORBIDDEN");
  }
}

/**
 * The local runtime is not running.
 *
 * Carries the startup hint from the contract, so the interface layer has nothing to invent.
 * A hint composed at the edge is a second copy of the operational instruction, and the copy
 * that says "retry later" is the one that sends the user away from the actual fix.
 */
export class LocalRuntimeUnavailableError extends Error {
  readonly code = "LOCAL_RUNTIME_UNAVAILABLE";
  constructor(readonly detail: string, readonly startupHint: string) {
    super("LOCAL_RUNTIME_UNAVAILABLE");
  }
}

/**
 * An outbound connection was attempted while a local organization's promise was in force.
 *
 * Thrown by the egress guard, i.e. from BELOW the code that tried it -- including from inside
 * a dependency that never heard of this project.
 */
export class LocalOrgEgressBlockedError extends Error {
  readonly code = "LOCAL_ORG_EGRESS_BLOCKED";
  constructor(readonly target: string) {
    super("LOCAL_ORG_EGRESS_BLOCKED");
  }
}
