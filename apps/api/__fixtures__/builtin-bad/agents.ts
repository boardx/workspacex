// Counter-proof fixture. Everything here MUST be caught by
// scripts/lint-no-builtin-capabilities.mjs. See no-builtin-capability-lists.test.ts.

// Rule 1 + rule 2: the prototype's agents, shipped as product content.
export const DEFAULT_AGENTS = ["Ava", "Atlas", "Scout"];

// Rule 2 alone: a list-shaped constant whose entries are not prototype names. This is the
// case that matters most -- the second customer's model list would look exactly like this.
export const models = ["gpt-5.2", "claude-opus-4.6", "llama-3-70b-local"];

// Rule 1 alone: a single entry, no list. A built-in does not need an array to be a built-in.
export function greet(): string {
  return "Warden";
}
