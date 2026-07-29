// Counter-proof fixture for the other direction: the gate must NOT fire on any of this.
// An over-firing gate gets muted, and this project has two precedents for exactly that.

import { identity } from "@repo/contracts";

// Derived from the contract, not a literal list. The six KINDS are product structure; the
// entries under them are organization configuration, and only the entries are forbidden.
export const CAPABILITY_KINDS = identity.CapabilityKind.options;

// A comment may name Ava, Atlas and Scout: documenting the rule is not breaking it.

// An array of strings whose name does not claim to be a capability set.
export const REASON_CODES = ["NO_ORG_MEMBERSHIP", "ORG_SCOPE_DENIED"];

// A single-entry list-shaped constant: not a list.
export const DEFAULT_SKILLS = ["only-one"];
