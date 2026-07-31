/**
 * COUNTER-PROOF FIXTURE. Not product code, not compiled (`__fixtures__` is excluded from
 * tsconfig), never imported by anything that ships.
 *
 * `credential-never-echoed.test.ts` runs its "nothing in apps/api/src can turn a sealed
 * credential back into plaintext" scan against this directory and asserts it FIRES. Without
 * that run, a scanner with a typo in its regular expression reports zero findings against
 * the real tree and reads exactly like a clean codebase.
 *
 * Each of the three shapes below is one a reviewer might wave through.
 */
import type { SealedCredential } from "../../../src/domain/model/credential-vault";

/** 1. The obvious one: an inverse of `seal`. */
export function unsealCredential(sealed: SealedCredential, key: string): string {
  return `${sealed.ciphertext}:${key}`;
}

/** 2. The polite one: a getter that does not say "decrypt" in its own name. */
export interface ModelCredentialReader {
  decrypt(ciphertext: string): string;
}

/** 3. The convenient one: a debugging helper that outlives the debugging. */
export function credentialPlaintextForDebug(sealed: SealedCredential): string {
  return sealed.ciphertext;
}
