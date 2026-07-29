/**
 * Password strength policy -- ruling O-28 ① (uc-1-1 R10, asserted by uc-1-1 R12 V5a).
 *
 * The ruling, in full, because every clause of it is a thing this function must NOT do:
 *
 *   length >= 12                      -- the only length rule
 *   NO forced character classes       -- upper/lower/digit/symbol are not required
 *   MUST check a weak-password list   -- a hit is rejected outright
 *   NO forced periodic rotation       -- there is no "your password expired" flow anywhere
 *
 * This is the current NIST position and it is counter-intuitive enough that it gets
 * "corrected" back to the familiar rules during review: length plus a leaked-password list
 * beats character-class arithmetic, and forced rotation reliably produces `Summer2026!`,
 * `Summer2026!!`, `Summer2026!!!`. So the ABSENCES are asserted, not just the presences --
 * see `login-password-auth.test.ts`, which fails if a character-class rule is added.
 *
 * Threshold comes from `AUTH_POLICY.passwordMinLen`, the single source (ADR-020). Writing
 * `12` here would be the second copy.
 */
import { auth as C } from "@repo/contracts";
import type { z } from "zod";

export type PasswordRejection = z.infer<typeof C.PasswordRejection>;

/**
 * A compact list of passwords that are both >= 12 characters AND well known from breach
 * corpora, in the normalised form the check uses (lowercased, whitespace stripped).
 *
 * ## What this list is, and what it is not
 *
 * It is NOT a substitute for a real breach corpus. A production deployment wants something
 * on the order of the Pwned Passwords set (~10^9 entries), consulted through a local
 * k-anonymity index. That is a deployment asset, not source code, and it cannot be an
 * online lookup here: X-3 says the local-organization path makes no outbound calls, so
 * "just call the HIBP API" is unavailable by construction, not by preference.
 *
 * What it IS: enough to make the rule REAL rather than decorative today, and -- more
 * importantly -- to make the shape right, so swapping in a large local list changes this
 * constant and nothing else. Entries shorter than the minimum length are omitted on
 * purpose: they are already rejected by the length rule, so listing them would inflate the
 * list while testing nothing.
 *
 * ⚠ `password123456` is here because uc-1-1 V5a names `Password123456` explicitly as a
 * password that must be refused DESPITE satisfying every character-class rule and the
 * length rule. It is the case that distinguishes this policy from the familiar one.
 */
const WEAK_PASSWORDS: ReadonlySet<string> = new Set([
  "password123456",
  "password1234",
  "passw0rd1234",
  "qwertyuiop123",
  "qwerty123456",
  "123456789012",
  "1234567890123",
  "12345678901234",
  "iloveyou1234",
  "administrator",
  "letmein123456",
  "welcome123456",
  "abc123456789",
  "monkey123456",
  "football1234",
  "sunshine1234",
  "princess1234",
  "trustno1234567",
  "superman1234",
  "michael123456",
  "starwars1234",
  "whatever1234",
  "changeme1234",
  "passwordpassword",
  "workspacex1234",
]);

/**
 * Fold a candidate the way the list is folded, so `Password123456` and `password123456`
 * are the same entry. Case-folding a password for the DICTIONARY CHECK does not weaken
 * anything -- the stored hash is still of the exact input -- while not folding would let
 * one capital letter walk straight past the list.
 */
function fold(password: string): string {
  return password.replace(/\s+/g, "").toLowerCase();
}

/**
 * Judge a candidate password. Returns null when acceptable.
 *
 * Returns a code rather than a message: the message is the interface layer's business, and
 * a domain function that returns Chinese prose cannot be reused by anything that renders
 * differently.
 */
export function checkPassword(password: string): PasswordRejection | null {
  if (password.length < C.AUTH_POLICY.passwordMinLen) return "TOO_SHORT";
  if (WEAK_PASSWORDS.has(fold(password))) return "WEAK_COMMON";
  return null;
}

/**
 * Exposed so the test can assert the list is NON-EMPTY and contains the case V5a names.
 *
 * Without this, "checks a weak-password list" is satisfied by an empty list, and every
 * assertion about it passes vacuously -- this project's single most repeated failure mode.
 */
export const WEAK_PASSWORD_COUNT = WEAK_PASSWORDS.size;
