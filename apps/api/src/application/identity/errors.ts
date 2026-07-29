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
