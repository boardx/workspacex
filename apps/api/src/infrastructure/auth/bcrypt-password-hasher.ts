/**
 * bcrypt password hashing -- invariant I-2.
 *
 * domain.md fixes the algorithm and its parameters as part of the CONTRACT: argon2id, or
 * bcrypt with cost >= 12. bcrypt is chosen here because `bcryptjs` is pure JavaScript --
 * no native build step, so the gate scripts and CI cannot fail for a reason unrelated to
 * anything this project is about. Swapping to argon2id later changes this file and the
 * CHECK constraint in migration 0010, and nothing else.
 *
 * The cost is asserted in three independent places, because one of them alone is a rule
 * nobody enforces:
 *   - here, at write time;
 *   - `credentials_hash_is_slow` in migration 0010, so the TABLE refuses a weak hash even
 *     from a backfill script that never runs this code;
 *   - `login-password-auth.test.ts`, which reads a stored hash and asserts its shape.
 */
import bcrypt from "bcryptjs";
import type { PasswordHasher } from "../../application/auth/ports";

/**
 * ⚠ Contract minimum (domain I-2). Raising it is fine; lowering it violates the signed
 * contract AND is rejected by the table's CHECK constraint.
 */
export const BCRYPT_COST = 12;

/**
 * A fixed, real bcrypt hash at the SAME cost, used only by `verifyDummy`.
 *
 * It has to be a genuine cost-12 hash of something: bcrypt's verification cost is driven by
 * the cost factor encoded in the digest, so a fake string would either throw or return
 * instantly -- and returning instantly is exactly the timing signal this exists to erase.
 *
 * The plaintext behind it is irrelevant and unrecoverable; nothing ever authenticates
 * against it. It is generated once at module load rather than checked in as a literal so it
 * cannot drift out of step with `BCRYPT_COST`.
 */
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-constant-time-login", BCRYPT_COST);

export class BcryptPasswordHasher implements PasswordHasher {
  /**
   * ⚠ The cost is a constructor argument ONLY so that the floor is enforceable at
   * construction. It is not a tuning knob: the default is the contract's value, and
   * anything below `BCRYPT_COST` throws rather than silently producing a hash the table's
   * `credentials_hash_is_slow` CHECK would reject at INSERT time -- a failure that would
   * otherwise surface as a database error at registration, far from its cause.
   */
  constructor(private readonly cost: number = BCRYPT_COST) {
    if (cost < BCRYPT_COST) {
      throw new Error(
        `bcrypt cost ${cost} is below the invariant I-2 floor of ${BCRYPT_COST}`,
      );
    }
  }

  async hash(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, this.cost);
  }

  async verify(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  }

  /**
   * ⚠ THE TIMING HALF OF I-1. Do not replace with `return false`.
   *
   * When login finds no account it calls this instead of `verify`, so both failure paths
   * spend the same ~100ms in bcrypt. Without it the two differ by roughly three orders of
   * magnitude and the login endpoint enumerates the user table for anyone with a stopwatch,
   * no matter how identical the response bodies are.
   *
   * The comparison result is discarded on purpose -- `compare` against DUMMY_HASH is
   * essentially never true, and if it somehow were, there is no account to log in to. The
   * work is the point, not the answer.
   */
  async verifyDummy(plaintext: string): Promise<false> {
    await bcrypt.compare(plaintext, DUMMY_HASH);
    return false;
  }
}
