/**
 * Credential custody for the model pool (F48 / uc-20-1 AC3, invariant I-6).
 *
 * AC3: "凭据永不回显、永不出现在接口响应、日志与审计明文中". Three surfaces, one rule.
 *
 * ## The shape of the guarantee
 *
 * A credential enters as plaintext exactly once, on `registerModel` / `configureModel`, and
 * is immediately turned into a `SealedCredential`. From that moment the plaintext exists
 * nowhere in this process: there is no field holding it, and **this module exports no way
 * to get it back**.
 *
 * That is not an oversight to be filled in later by an `unseal()` next to `seal()`. The
 * only legitimate reader of a model credential is the outbound provider call, which does
 * not exist in phase-1 (`domain.md` 四: the model gateway is not this bundle's, and
 * `routeModelCall` is its single entry point). When it is built it will need a port on the
 * INFRASTRUCTURE side holding the decryption key -- deliberately not an inward-facing
 * domain function that any use case could reach for. `credential-never-echoed.test.ts`
 * asserts that no such reader exists anywhere in `apps/api/src` today, so the day one
 * appears it is a red test and a review, not a quiet import.
 *
 * ## Why the mask reveals nothing at all
 *
 * A `sk-...abcd` mask is the industry habit and it is a disclosure decision nobody on this
 * project made. Last-four is enough to confirm a guess, and the prototype's requirement is
 * only "掩码呈现且无『查看』按钮" -- it never asks for a recognisable tail. So the mask is
 * a constant: it carries the fact THAT a credential is configured and no bit of WHICH one.
 *
 * ⚠ The mask is a constant for a second reason: a mask derived from the ciphertext leaks
 * ciphertext equality. Two models sharing one key would render identically, which tells a
 * reader something the response was never meant to say.
 */

/**
 * Ciphertext plus what is needed to decrypt it later. Never the plaintext.
 *
 * `readonly` throughout and branded: a plain `{ ciphertext }` object literal cannot be
 * passed where a `SealedCredential` is expected, so "I already encrypted this" cannot be
 * asserted by a caller that did not.
 */
export interface SealedCredential {
  readonly ciphertext: string;
  /** Which algorithm and key generation produced it -- needed to rotate without a downtime. */
  readonly algorithm: string;
  readonly keyId: string;
  readonly sealedAt: string;
  /** Brand. Structural typing would otherwise let any similar literal through. */
  readonly __sealed: true;
}

/** What the vault needs from infrastructure. Declared here, implemented outside the domain. */
export interface CredentialCipher {
  readonly algorithm: string;
  readonly keyId: string;
  /** Encrypt. ⚠ Deliberately no matching `decrypt` -- see the header. */
  encrypt(plaintext: string): string;
}

/** The rendered form. No prefix, no tail, no length hint. */
export const CREDENTIAL_MASK = "••••••••";

/**
 * Wrap a plaintext credential. The only entry point; there is no exit.
 *
 * `sealedAt` is passed in rather than read from a clock, because the domain has no clock
 * (every other file in this layer follows the same rule) and because a test that cannot fix
 * the timestamp cannot assert on the record it produces.
 */
export function sealCredential(
  plaintext: string,
  cipher: CredentialCipher,
  sealedAt: string,
): SealedCredential {
  if (plaintext.length === 0) {
    throw new Error("refusing to seal an empty credential: an empty secret is a missing secret");
  }
  return {
    ciphertext: cipher.encrypt(plaintext),
    algorithm: cipher.algorithm,
    keyId: cipher.keyId,
    sealedAt,
    __sealed: true,
  };
}

/**
 * What the interface layer may render for a configured credential.
 *
 * Takes the sealed value and ignores it. The parameter exists so the call site reads as
 * "render THIS credential" and so the type system stops anyone rendering a plaintext
 * string; the body proves the rendering cannot depend on the secret.
 */
export function maskCredential(sealed: SealedCredential | null): string | null {
  return sealed === null ? null : CREDENTIAL_MASK;
}

/**
 * Is a credential configured? The one bit about it that may cross a response boundary.
 *
 * The admin console needs it to show "已配置 / 未配置", and a boolean is the whole of what
 * it needs. Separated from `maskCredential` so a caller that only wants the bit is not
 * handed a string that looks like it might contain something.
 */
export function hasCredential(sealed: SealedCredential | null): boolean {
  return sealed !== null;
}

/**
 * Redact any occurrence of a plaintext secret from a string bound for a log or an audit row.
 *
 * ## Why this exists when nothing holds the plaintext
 *
 * The plaintext survives one moment: between arriving on the request and being sealed. If
 * the request body is logged in that window -- by a framework's request logger, by an error
 * handler serialising the DTO -- AC3's "日志与审计明文中" is broken by code nobody wrote
 * for that purpose. This is the belt for that window; the seal is the braces.
 *
 * ⚠ Order matters: longest first, so a secret that contains another secret as a prefix does
 * not leave the tail of the longer one behind.
 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  const present = secrets.filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
  let out = text;
  for (const secret of present) out = out.split(secret).join(CREDENTIAL_MASK);
  return out;
}
