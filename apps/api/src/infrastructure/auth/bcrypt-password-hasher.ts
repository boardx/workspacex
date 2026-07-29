/**
 * `PasswordHasher` implementation -- invariant I-2.
 *
 * ## Why bcrypt cost 12 and not argon2id
 *
 * The contract accepts either ("argon2id 或 bcrypt cost >= 12"). argon2id is the better
 * primitive, and every JS argon2 binding is a NATIVE module: a prebuilt binary per
 * platform, a compile step where there is no prebuild, and a class of CI failure that has
 * nothing to do with this feature. `bcryptjs` is pure JavaScript, so the hash this file
 * produces on a maintainer's laptop is byte-compatible with the one CI produces, and there
 * is no toolchain in between.
 *
 * ⚠ The cost of that choice, stated rather than glossed: pure-JS bcrypt is several times
 * slower than the native implementation at the same cost factor, so cost 12 here is
 * *more* expensive per hash than cost 12 elsewhere -- fine for a defender, and it means a
 * registration request spends most of a second in this function. That is why the use case
 * hashes OUTSIDE the transaction (see the note there).
 *
 * ## Why the cost is 12 and not "at least 12"
 *
 * Because 12 is the contract's floor and a floor is what gets read as "the number". Raising
 * it is a deliberate act with a measurable latency cost; it is a constant here so that act
 * is one edit in one place, and `password-hash-invariant.test.ts` asserts the stored hash's
 * cost field is >= 12 rather than == 12, so raising it does not break a test.
 */
import bcrypt from "bcryptjs";
import type { PasswordHasher } from "../../application/auth/ports";

/** Invariant I-2's floor. */
export const BCRYPT_COST = 12;

export class BcryptPasswordHasher implements PasswordHasher {
  constructor(private readonly cost: number = BCRYPT_COST) {
    // A cost below the contract's floor is not a configuration choice, it is a violation of
    // I-2 -- and it would be one that produces perfectly valid-looking hashes. Refusing at
    // construction means the process does not start, rather than quietly storing weak
    // hashes that only a schema CHECK later objects to.
    if (cost < BCRYPT_COST) {
      throw new Error(`bcrypt cost ${cost} is below the invariant I-2 floor of ${BCRYPT_COST}`);
    }
  }

  /**
   * ⚠ The plaintext is never logged, never returned, and never stored on `this`.
   *
   * `lint-error-leak` does not cover this layer and no linter checks "did you log the
   * password", so the discipline is: this function's only output is its return value.
   * `tests/auth/password-hash-invariant.test.ts` scans every auth source file for a log or
   * error call that mentions a password-ish identifier, which is the mechanical half.
   */
  hash(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, this.cost);
  }

  /**
   * F20 uses this. Present so there is one hasher port rather than two implementations
   * that could disagree about the algorithm.
   *
   * ⚠ `bcrypt.compare` is constant-time with respect to the hash comparison, and it
   * deliberately does the full KDF work even for a wrong password -- which is the property
   * F20's I-1 timing half depends on. Do not "optimise" a fast pre-check in front of it.
   */
  verify(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  }
}
