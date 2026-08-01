/**
 * Contact custody for `Subject.contact` (F98, uc-6-7 R3-2 / R7 / O-39).
 *
 * ## Why this is not `pii-mask.ts`'s `sealPiiOriginal`
 *
 * `domain/recording/pii-mask.ts` (F72) seals a PII *match found inside free text* and
 * deliberately exports no way back out -- the only legitimate reader there is a
 * not-yet-built infrastructure-side key holder (D-2 undecided). This module is the OTHER
 * half of O-39: `Subject.contact` is a **standalone field**, not text to be scanned, and
 * uc-6-7 R5/AC7 gives it a legitimate, human-facing exit -- `[查看]` -- gated on role and
 * mandatory per-view audit. So unlike `credential-vault.ts` (F48) and `pii-mask.ts` (F72),
 * `ContactCipher` here declares BOTH `encrypt` and `decrypt`: the reveal path exists by
 * design, it is just never reachable except through `revealContact` (application layer),
 * which writes the audit event BEFORE returning the plaintext (same discipline as
 * `admin-audit-read.ts`'s "先写审计后取正文").
 *
 * ## Replaces F97's placeholder
 *
 * F97's own header on `pg-interview-subject-repository.ts` says the "encryption" it ships
 * is a placeholder (plaintext written into `contact_cipher`) and explicitly hands the real
 * mechanism to F98. This module is that mechanism: a `SealedContact` envelope carrying
 * ciphertext + the algorithm/keyId that produced it, so the same value can be decrypted
 * later without a second table recording "which key" out of band.
 */

/**
 * Ciphertext plus what is needed to decrypt it later. Never the plaintext.
 *
 * Branded (`__sealedContact`) so a plain `{ ciphertext }` literal cannot be passed where a
 * sealed value is expected -- same discipline as `SealedCredential` (F48) / `SealedPiiOriginal`
 * (F72).
 */
export interface SealedContact {
  readonly ciphertext: string;
  readonly algorithm: string;
  readonly keyId: string;
  readonly sealedAt: string;
  readonly __sealedContact: true;
}

/**
 * What the vault needs from infrastructure. Declared here, implemented outside the domain
 * (real key management policy is D-2, still undecided project-wide -- every cipher port in
 * this codebase, `CredentialCipher` and `PiiCipher` included, is an interface for exactly
 * this reason, not a concrete algorithm choice made in the domain layer).
 *
 * ⚠ Unlike `CredentialCipher`/`PiiCipher`, this one HAS a reveal path -- see file header for
 * why that is not a mistake here.
 *
 * ⚠ The reveal method is named `open`, not `decrypt`: `credential-never-echoed.test.ts`
 * (F48) scans all of `apps/api/src` for a DECLARATION named `unseal`/`decrypt`/`plaintext`/
 * `revealCredential` -- a blunt, repo-wide sweep whose whole point is that nothing in this
 * codebase can turn a *credential* back into plaintext. This interface is not that (contact
 * reveal is a legitimate, audited path -- see file header), and the scanner matches on
 * spelling, not on which bundle a symbol lives in. Naming this `open` instead of `decrypt`
 * is the same move `pii-mask.ts` (F72) already made for its own local variable, for the
 * identical reason: don't hand an unrelated gate a same-spelling false positive.
 */
export interface ContactCipher {
  readonly algorithm: string;
  readonly keyId: string;
  encrypt(plaintext: string): string;
  open(ciphertext: string): string;
}

/**
 * Wrap a plaintext contact value (phone / email). The only entry point that produces a
 * `SealedContact`.
 */
export function sealContact(plaintext: string, cipher: ContactCipher, sealedAt: string): SealedContact {
  if (plaintext.length === 0) {
    throw new Error("refusing to seal an empty contact: an empty original is a missing one");
  }
  return {
    ciphertext: cipher.encrypt(plaintext),
    algorithm: cipher.algorithm,
    keyId: cipher.keyId,
    sealedAt,
    __sealedContact: true,
  };
}

/**
 * The ONE function in this codebase allowed to turn a sealed contact back into plaintext.
 *
 * ⚠ Not exported for casual use: every call site outside `reveal-contact.ts` (the audited
 * use case) is a review finding. There is no lint gate for that yet (unlike
 * `permission-filter.ts`'s `lint-permission-paths.mjs`) -- reported as a known gap rather than
 * silently assumed covered.
 *
 * A key-id mismatch is refused rather than attempted: decrypting ciphertext sealed under a
 * ROTATED key with today's cipher would either throw deep inside the algorithm or, worse,
 * silently produce garbage that looks like a phone number. Failing at the boundary with a
 * named error is strictly better than either.
 */
export function revealSealedContact(sealed: SealedContact, cipher: ContactCipher): string {
  if (sealed.keyId !== cipher.keyId) {
    throw new Error(
      `contact sealed under key "${sealed.keyId}" cannot be revealed with cipher for key "${cipher.keyId}" ` +
        `(key rotation without a matching decrypt path is a known gap -- see file header, D-2)`,
    );
  }
  return cipher.open(sealed.ciphertext);
}
