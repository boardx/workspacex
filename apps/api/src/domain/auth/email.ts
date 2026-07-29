/**
 * Email normalisation -- the ONE place that decides what "the same email" means.
 *
 * domain.md §1 says `email` is unique "after lowercase normalisation". That sentence has to
 * be executable in exactly one function, because it is consulted in four places (credential
 * lookup, credential creation, login-attempt counting, password-reset request) and any two
 * of them disagreeing produces a specific, silent bug: an attacker registers
 * `Victim@Example.com`, the lookup path lowercases and the counting path does not, and the
 * lockout counter never reaches the threshold for the address actually being attacked.
 *
 * Deliberately NOT doing more than this:
 *   - no stripping of `+tag` suffixes: `a+x@example.com` is a different mailbox from
 *     `a@example.com` at some providers, and treating them as one account is an account
 *     takeover, not a convenience.
 *   - no dot-folding for gmail: same reason, and it is provider-specific behaviour that
 *     does not belong in a domain rule.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
