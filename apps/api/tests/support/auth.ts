/**
 * Fixtures for the `auth` bundle tests.
 *
 * Real PostgreSQL and real Redis, not fakes. The claims F20/F21 make are about a slow hash's
 * elapsed time, an atomic conditional UPDATE, and a revocation that spans every session --
 * all three are properties of the actual stores. An in-memory double would test the shape of
 * the code and none of the thing that can be wrong.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { BCRYPT_COST } from "../../src/infrastructure/auth/bcrypt-password-hasher";
import { normalizeEmail } from "../../src/domain/auth/email";
import { asOwner } from "./db";

const API_DIR = fileURLToPath(new URL("../..", import.meta.url));
const COMPOSE = ["compose", "-f", `${API_DIR}/docker-compose.dev.yml`, "-p", "workspacex-kernel"];

function redisReady(): boolean {
  try {
    const out = execFileSync("docker", [...COMPOSE, "exec", "-T", "redis", "redis-cli", "PING"], {
      stdio: "pipe",
      encoding: "utf8",
    });
    return out.includes("PONG");
  } catch {
    return false;
  }
}

/**
 * Bring Redis up, tolerating the create race.
 *
 * Identical shape to `ensureDatabase()` and for the identical reason: vitest runs test files
 * in parallel processes, every one of them calls this, and `docker compose up` is idempotent
 * in its EFFECT but not in its EXECUTION -- eleven of twelve callers die with
 * `Conflict. The container name "..." is already in use`. It never reproduces locally,
 * because the container has been up for hours by the time anyone runs the suite.
 */
export function ensureRedis(): void {
  if (redisReady()) return;
  try {
    execFileSync("docker", [...COMPOSE, "up", "-d", "redis"], { stdio: "pipe" });
  } catch (e) {
    const out = `${(e as { stdout?: string }).stdout ?? ""}${(e as { stderr?: string }).stderr ?? ""}`;
    if (!/already in use|Conflict/i.test(out)) throw e;
  }
  for (let i = 0; i < 60; i++) {
    if (redisReady()) return;
    execFileSync("sleep", ["1"]);
  }
  throw new Error("redis did not become ready");
}

/**
 * Seed one account.
 *
 * Written as the OWNER, unlike the tenant fixtures in `db.ts` which deliberately go through
 * the app role to prove a policy's WITH CHECK is right. There is no policy here to prove
 * anything about: these tables carry the declared `kernel-no-tenant-data:` exemption
 * (migration 0010), so an owner insert and an app insert take the same path.
 *
 * The hash is produced by real bcrypt at the real cost -- a cheap fake would make the
 * timing assertions in `login-enumeration-guard.test.ts` meaningless, since the whole point
 * there is that verification is slow.
 */
export async function seedCredential(opts: {
  userId: string;
  email: string;
  password: string;
  emailVerified?: boolean;
}): Promise<{ userId: string; email: string }> {
  const email = normalizeEmail(opts.email);
  const hash = await bcrypt.hash(opts.password, BCRYPT_COST);
  await asOwner(async (c) => {
    await c.query(
      `INSERT INTO credentials (user_id, email, password_hash, email_verified_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET email = EXCLUDED.email,
             password_hash = EXCLUDED.password_hash,
             email_verified_at = EXCLUDED.email_verified_at`,
      [opts.userId, email, hash, (opts.emailVerified ?? true) ? new Date() : null],
    );
  });
  return { userId: opts.userId, email };
}

/**
 * Remove the named accounts and everything hanging off them.
 *
 * SCOPED, not a global TRUNCATE -- same discipline as `resetOrgs`. Every auth test file owns
 * its own user ids and email addresses and cleans up only those, because vitest runs the
 * files in parallel against one database and a global cleanup deletes another file's
 * fixtures mid-test.
 *
 * `login_attempts` is keyed by EMAIL and has no FK (a failed attempt against a
 * non-existent address must still be recorded), so it is deleted explicitly; the reset
 * tokens ride along on ON DELETE CASCADE.
 */
export async function resetCredentials(userIds: string[], emails: string[]): Promise<void> {
  const normalized = emails.map(normalizeEmail);
  await asOwner(async (c) => {
    await c.query("DELETE FROM credentials WHERE user_id = ANY($1::text[])", [userIds]);
    await c.query("DELETE FROM login_attempts WHERE email = ANY($1::text[])", [normalized]);
  });
}

/** Read a stored hash directly, so I-2's "stored as a slow hash" is assertable. */
export async function storedPasswordHash(userId: string): Promise<string | null> {
  return asOwner(async (c) => {
    const r = await c.query<{ password_hash: string }>(
      "SELECT password_hash FROM credentials WHERE user_id = $1",
      [userId],
    );
    return r.rows[0]?.password_hash ?? null;
  });
}

/** Backdate attempts so "the rolling window expires" is assertable without a 15-minute sleep. */
export async function backdateAttempts(email: string, ms: number): Promise<void> {
  await asOwner((c) =>
    c.query("UPDATE login_attempts SET at = at - make_interval(secs => $2) WHERE email = $1", [
      normalizeEmail(email),
      ms / 1000,
    ]),
  );
}
