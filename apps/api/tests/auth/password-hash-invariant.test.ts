/**
 * Invariant I-2: **passwords are stored only as a slow hash (argon2id or bcrypt cost >= 12),
 * and plaintext or reversible encodings appear NOWHERE.**
 *
 * Four independent things have to be true, and each can hold while another fails:
 *   1. the hasher produces a conforming hash                    (and the password is not in it)
 *   2. the DATABASE refuses a non-conforming one                (every writer, not just this one)
 *   3. the contract's regex and the schema's CHECK agree        (or storage loosens silently)
 *   4. no code path logs the password                           (a perfect hash, printed)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { auth as C } from "@repo/contracts";
import { BCRYPT_COST, BcryptPasswordHasher } from "../../src/infrastructure/auth/bcrypt-password-hasher";
import { asOwner, ensureDatabase, migrateOnce } from "../support/db";

const PASSWORD = "correct-horse-battery-staple";

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
});

afterAll(async () => {
  await asOwner((c) => c.query(`DELETE FROM credentials WHERE user_id LIKE 'u-i2-%'`));
});

describe("1. the hasher", () => {
  it("produces a hash the contract accepts, at cost >= 12", async () => {
    const hash = await new BcryptPasswordHasher().hash(PASSWORD);
    expect(C.PasswordHashFormat.safeParse(hash).success, hash).toBe(true);
    // The cost field, read out rather than assumed. `>=`, not `===`: raising the cost is a
    // legitimate act and must not be blocked by its own test (the same reasoning
    // contract-design.md hard rule 7 applies to enum sizes).
    const cost = Number(hash.split("$")[2]);
    expect(cost).toBeGreaterThanOrEqual(12);
    expect(BCRYPT_COST).toBeGreaterThanOrEqual(12);
  });

  it("the password is not recoverable from, or contained in, the hash", async () => {
    const hash = await new BcryptPasswordHasher().hash(PASSWORD);
    expect(hash).not.toContain(PASSWORD);
    // Nor any reversible encoding of it. Enumerated rather than hand-waved, because
    // "it's hashed" has been said about base64 more than once.
    expect(hash).not.toContain(Buffer.from(PASSWORD).toString("base64"));
    expect(hash).not.toContain(Buffer.from(PASSWORD).toString("hex"));
  });

  it("salts: the same password twice gives two different hashes, both verifying", async () => {
    const h = new BcryptPasswordHasher();
    const a = await h.hash(PASSWORD);
    const b = await h.hash(PASSWORD);
    expect(a).not.toBe(b);
    // Two-way: it verifies the right password and refuses the wrong one. Asserting only the
    // first half would pass for a `verify` that returns true unconditionally.
    expect(await h.verify(PASSWORD, a)).toBe(true);
    expect(await h.verify(PASSWORD, b)).toBe(true);
    expect(await h.verify("wrong-password-entirely", a)).toBe(false);
  });

  it("refuses to be constructed below the floor", () => {
    expect(() => new BcryptPasswordHasher(10)).toThrow(/below the invariant I-2 floor/);
    expect(() => new BcryptPasswordHasher(12)).not.toThrow();
  });
});

describe("2. the database refuses a non-conforming hash, whoever writes it", () => {
  async function insertHash(userId: string, hash: string) {
    return asOwner((c) =>
      c.query(
        `INSERT INTO credentials (user_id, email, display_name, password_hash) VALUES ($1, $2, 'x', $3)`,
        [userId, `${userId}@i2.test`, hash],
      ),
    );
  }

  it("plaintext is rejected -- by the OWNER, i.e. by the most privileged writer there is", async () => {
    // The owner bypasses RLS and every application layer. If plaintext gets in here, it gets
    // in from a repair script, a fixture, or a migration -- the writers nobody reviews.
    await expect(insertHash("u-i2-plain", PASSWORD)).rejects.toThrow(/password_hash/);
  });

  it("bcrypt below cost 12 is rejected", async () => {
    await expect(
      insertHash("u-i2-weak", "$2b$04$abcdefghijklmnopqrstuvabcdefghijklmnopqrstuvwxyz01234"),
    ).rejects.toThrow(/password_hash/);
  });

  it("base64 of the password is rejected (a 'reversible encoding' is not a hash)", async () => {
    await expect(
      insertHash("u-i2-b64", Buffer.from(PASSWORD).toString("base64")),
    ).rejects.toThrow(/password_hash/);
  });

  it("...and a real cost-12 hash IS accepted, so the constraint is not simply a wall", async () => {
    const hash = await new BcryptPasswordHasher().hash(PASSWORD);
    await expect(insertHash("u-i2-good", hash)).resolves.toBeDefined();
  });
});

describe("3. the contract's regex and the schema's CHECK agree", () => {
  /**
   * The one duplicated fact this feature permits: `PasswordHashFormat` in the contract and
   * the CHECK in `0010-f19-auth-registration.sql` say the same thing in two languages,
   * because a TS regex cannot be executed by PostgreSQL.
   *
   * The condition for allowing it was that drift FAILS rather than loosens. This is that
   * test: both are run against the same samples and must give the same verdict, sample by
   * sample. If someone relaxes the cost floor in one place, this goes red.
   */
  it("both accept and reject the same samples", async () => {
    const good = [
      await new BcryptPasswordHasher().hash(PASSWORD),
      "$2a$12$abcdefghijklmnopqrstuvabcdefghijklmnopqrstuvwxyz01234",
      "$2y$14$abcdefghijklmnopqrstuvabcdefghijklmnopqrstuvwxyz01234",
      "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$c29tZWhhc2h2YWx1ZQ",
    ];
    const bad = [
      PASSWORD,
      "",
      "$2b$04$abcdefghijklmnopqrstuvabcdefghijklmnopqrstuvwxyz01234", // cost 4
      "$2b$11$abcdefghijklmnopqrstuvabcdefghijklmnopqrstuvwxyz01234", // cost 11, just under
      "$argon2i$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$c29tZWhhc2g", // argon2i, not argon2id
      "md5:5f4dcc3b5aa765d61d8327deb882cf99",
      Buffer.from(PASSWORD).toString("base64"),
    ];

    const sqlVerdict = await asOwner(async (c) => {
      const r = await c.query<{ s: string; ok: boolean }>(
        `SELECT s, (
            s ~ '^\\$2[aby]\\$(1[2-9]|[2-9][0-9])\\$[./A-Za-z0-9]{53}$'
            OR s ~ '^\\$argon2id\\$v=[0-9]+\\$m=[0-9]+,t=[0-9]+,p=[0-9]+\\$[^$]+\\$[^$]+$'
          ) AS ok
         FROM unnest($1::text[]) AS s`,
        [[...good, ...bad]],
      );
      return new Map(r.rows.map((x) => [x.s, x.ok]));
    });

    for (const s of good) {
      expect(C.PasswordHashFormat.safeParse(s).success, `contract rejected a valid hash: ${s}`).toBe(true);
      expect(sqlVerdict.get(s), `schema rejected a valid hash: ${s}`).toBe(true);
    }
    for (const s of bad) {
      expect(C.PasswordHashFormat.safeParse(s).success, `contract accepted: ${s}`).toBe(false);
      expect(sqlVerdict.get(s), `schema accepted: ${s}`).toBe(false);
    }
    // Non-vacuity: if the SQL had returned nothing (a typo in the query, an empty array),
    // every `.get()` above would be `undefined` and every `toBe(false)` would still fail --
    // but every `toBe(true)` would too. Asserted explicitly so a future edit cannot make
    // this whole block silently compare nothing.
    expect(sqlVerdict.size).toBe(good.length + bad.length);
  });
});

describe("4. no auth code path can print a password", () => {
  /**
   * A perfect hash is worthless if the plaintext went to stdout on the way in.
   *
   * `lint-error-leak` covers only `src/interface/` and only error objects, so nothing in the
   * repo checks this. The scan is deliberately narrow -- an identifier that looks like a
   * password, appearing as an argument to a log/print call -- because this project has two
   * precedents of a noisy gate being muted.
   */
  // Scoped to the files a password actually passes through. Scanning every controller
  // would drag other features' files into this feature's gate, and the first false positive
  // in somebody else's file is how a gate gets muted.
  const AUTH_DIRS = ["src/domain/auth", "src/application/auth", "src/infrastructure/auth"];
  const AUTH_FILES = ["src/interface/controllers/auth-registration.controller.ts"];

  function walk(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      statSync(p).isDirectory() ? walk(p, out) : /\.ts$/.test(n) && out.push(p);
    }
    return out;
  }

  const API = fileURLToPath(new URL("../..", import.meta.url));
  const targets = (): string[] => [
    ...AUTH_DIRS.flatMap((d) => walk(join(API, d))),
    ...AUTH_FILES.map((f) => join(API, f)),
  ];
  const SINK = /\b(?:console\.\w+|logger\.\w+|this\.logger\.\w+|process\.stdout\.write|process\.stderr\.write|new Error)\s*\(/;
  const SECRET = /\b(password|plaintext|passwordHash|verificationToken|token)\b/;

  /**
   * String literals are emptied before the identifier scan.
   *
   * Found by this test's first run: `throw new Error("password hasher produced a hash that
   * violates invariant I-2")` was flagged. That message contains the WORD, not the VALUE --
   * and the distinction is the whole point, because the thing being banned is passing the
   * variable, not naming the concept.
   *
   * Left unfixed, this is the exact failure mode `lint-permission-paths` and
   * `lint-omission-reason` both have precedents for: a gate that over-fires gets muted, and
   * a muted gate protects nothing. So the noise is removed rather than the assertion
   * weakened -- the counter-proof below covers both directions.
   */
  const stripLiterals = (s: string): string =>
    s.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, "``");

  it("scans real files (otherwise this section is decorative)", () => {
    expect(targets().length, "scanned no files").toBeGreaterThanOrEqual(7);
  });

  it("no log/throw call in the auth path takes a password-ish identifier", () => {
    const offenders: string[] = [];
    for (const file of targets()) {
      const body = readFileSync(file, "utf8");
      body.split("\n").forEach((line, i) => {
        // Comments explaining the rule are documentation of it, not violations -- the same
        // exemption lint-error-leak and lint-permission-paths both make.
        if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
        if (!SINK.test(line)) return;
        // Only the argument list, so `const password = ...` on a line that also logs
        // something unrelated is not conflated with logging the password.
        const args = stripLiterals(line.slice(line.indexOf("(", line.search(SINK))));
        if (SECRET.test(args)) offenders.push(`${relative(API, file)}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(offenders, `a secret may reach a log or an error message:\n  ${offenders.join("\n  ")}`)
      .toEqual([]);
  });

  it("the scan is not vacuous: it DOES catch the pattern it is looking for", () => {
    // The counter-proof, inline and permanent. Without it, a regex that matched nothing
    // would look exactly like a clean codebase.
    const argsOf = (s: string) => stripLiterals(s.slice(s.indexOf("(", s.search(SINK))));

    // Fires on the real thing: the VALUE reaching a sink.
    const leak = `  this.logger.error("hash failed", { password });`;
    expect(SINK.test(leak)).toBe(true);
    expect(SECRET.test(argsOf(leak))).toBe(true);

    // Does not fire on an ordinary log line...
    expect(SECRET.test(argsOf(`  this.logger.error("hash failed", { userId });`))).toBe(false);

    // ...nor on a message that merely NAMES the concept, which is what the first run of
    // this test got wrong. Both halves are asserted, because a scanner that stopped firing
    // altogether would also pass the line above.
    expect(
      SECRET.test(argsOf(`  throw new Error("password hasher produced a bad hash");`)),
      "the literal-stripping made the scanner blind",
    ).toBe(false);
    expect(SECRET.test(argsOf(`  throw new Error("bad hash: " + passwordHash);`))).toBe(true);
  });
});
