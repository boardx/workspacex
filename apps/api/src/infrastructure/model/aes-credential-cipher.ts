/**
 * The `CredentialCipher` implementation (F48 / uc-20-1 AC3, invariant I-6).
 *
 * ## There is no inverse in this file, and that is the design
 *
 * `CredentialCipher` declares `encrypt` and nothing else (`domain/model/credential-vault.ts`
 * header). This class implements exactly that surface. AES-256-GCM is reversible
 * mathematics, so the guarantee is NOT "the bytes cannot be recovered" -- it is that no
 * code path in `apps/api/src` performs the recovery, which `credential-never-echoed.test.ts`
 * asserts by scanning for a declared reader.
 *
 * When the outbound provider gateway arrives (phase-1 has none -- `domain.md` 四, and
 * `routeModelCall` is its single entry point) it needs its own module, its own key handle
 * and its own review. Adding the inverse HERE would put it one import away from every use
 * case, which is the arrangement the vault header exists to prevent.
 *
 * ## The IV is per-call and travels in the ciphertext
 *
 * GCM is catastrophically broken by IV reuse: two credentials sealed under one key and one
 * IV leak their XOR. `randomBytes(12)` per seal, prefixed to the output, so the stored
 * string is self-describing and no second column has to stay in sync with it.
 *
 * Layout: `<iv-hex>.<authTag-hex>.<ciphertext-hex>`. The auth tag is kept even though
 * nothing verifies it today -- discarding it would make the record permanently
 * un-decryptable, turning "we have not built the reader yet" into "the credentials the
 * customer entered are gone".
 */
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import type { CredentialCipher } from "../../domain/model/credential-vault";

/**
 * How the key is supplied.
 *
 * ⚠ No default value, unlike `pg-config.ts`'s host and port. A development fallback for a
 * connection host is a convenience; a development fallback for an encryption key is a
 * production deployment that seals every customer's credentials under a constant that is in
 * the git history. Missing env is a startup failure.
 */
export const MODEL_CREDENTIAL_KEY_ENV = "MODEL_CREDENTIAL_KEY";

export interface AesCredentialCipherOptions {
  /** Raw key material. Hashed to 32 bytes, so the operator is not forced to supply exactly 32. */
  readonly key: string;
  /**
   * Which key generation sealed a record, stored alongside the ciphertext so a future
   * rotation can tell old records from new ones without a downtime.
   */
  readonly keyId: string;
}

export class AesCredentialCipher implements CredentialCipher {
  readonly algorithm = "aes-256-gcm";
  readonly keyId: string;

  /** 32 bytes derived from the supplied material. Private: nothing outside may read it. */
  readonly #key: Buffer;

  constructor(options: AesCredentialCipherOptions) {
    if (options.key.length === 0) {
      throw new Error("refusing to build a credential cipher from an empty key");
    }
    this.#key = createHash("sha256").update(options.key, "utf8").digest();
    this.keyId = options.keyId;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.#key, iv);
    const body = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
    return `${iv.toString("hex")}.${c.getAuthTag().toString("hex")}.${body.toString("hex")}`;
  }
}

/**
 * Build the cipher from the environment.
 *
 * `keyId` is derived from the key rather than configured separately: two sources for "which
 * key is this" is the same-fact-twice failure, and a `keyId` an operator can set
 * independently of the key is a `keyId` that will eventually lie. A short digest prefix
 * identifies the generation and discloses nothing usable about the key.
 */
export function credentialCipherFromEnv(): AesCredentialCipher {
  const key = process.env[MODEL_CREDENTIAL_KEY_ENV];
  if (key === undefined || key === "") {
    throw new Error(`missing env var ${MODEL_CREDENTIAL_KEY_ENV}`);
  }
  return new AesCredentialCipher({
    key,
    // ⚠ A digest of the KEY, not the key. 8 hex chars of SHA-256 identifies the generation
    // and is not a shortcut to the material.
    keyId: `k-${createHash("sha256").update(key, "utf8").digest("hex").slice(0, 8)}`,
  });
}
