/**
 * F48 · uc-20-1 AC3 / invariant I-6 -- 凭据永不回显、永不出现在接口响应、日志与审计明文中.
 *
 * ## Every assertion here is a REVERSE assertion
 *
 * "The response does not contain the credential" is trivially true of a response that
 * contains nothing, and the four gates below would all pass against an empty contract, an
 * empty source tree and an empty migration. So each one is paired with either a planted
 * counter-example that must be caught, or a positive control proving the scanner sees
 * anything at all:
 *
 *   · the response-schema scan is run against a planted schema carrying `credential`
 *   · the source scan for a plaintext reader is run against `__fixtures__/f48-credential-leak`
 *   · the SQL grant check asserts `models` DOES have SELECT while `model_secrets` does not
 *   · the redaction check asserts the un-redacted string DOES contain the secret
 *
 * ## "任何角色下都取不到明文" -- how that is asserted without a role parameter
 *
 * It is asserted BY the absence of one. `projectPoolRow` takes the registration and an
 * identity pair; it cannot be told who is asking, so it has no branch that could answer an
 * admin differently. The admin-only branch is where a "credentials are visible to admins"
 * design puts its leak, and a function that cannot see the role cannot grow it. The test
 * pins the arity so the day someone threads a principal through, this is a red test and a
 * conversation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { agentRuntime as C } from "@repo/contracts";
import {
  CREDENTIAL_MASK,
  hasCredential,
  maskCredential,
  redactSecrets,
  sealCredential,
  type CredentialCipher,
} from "../../../src/domain/model/credential-vault";
import {
  projectPoolRow,
  responseSchemas,
  schemaKeyNames,
  type RegisterModelInput,
} from "../../../src/domain/model/registry";

const API_SRC = fileURLToPath(new URL("../../../src", import.meta.url));
const LEAK_FIXTURE = fileURLToPath(new URL("../../../__fixtures__/f48-credential-leak", import.meta.url));
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../migrations", import.meta.url));
const MIGRATION = fileURLToPath(
  new URL("../../../migrations/0019-f48-model-pool.sql", import.meta.url),
);

const PLAINTEXT = "sk-live-9f2b7c11-never-echo-me";

/**
 * Secret-shaped response keys.
 *
 * `endpointHint` is exempt BY NAME and by shape, not by a loose regular expression: the
 * contract makes it a two-value enum precisely so a non-admin's row can say "internal" or
 * "external" without carrying an address. The exemption is checked below rather than
 * trusted -- if it ever becomes a free string, the assertion that it is an enum fails.
 *
 * `tokens` is a token COUNT on tool-call records. Excluded by requiring `token` to be part
 * of `accessToken` / `apiToken` rather than matching the bare word, because an over-firing
 * secret scanner is one somebody eventually deletes.
 */
const SECRET_KEY_RE = /credential|secret|passw|api[-_]?key|access[-_]?token|bearer|^endpoint$/i;

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walkFiles(p, out) : /\.ts$/.test(n) && out.push(p);
  }
  return out;
}

/** Secret-shaped keys anywhere in a response schema, reported with their operation name. */
function secretKeysInResponses(
  schemas: ReadonlyMap<string, z.ZodTypeAny>,
): { op: string; key: string }[] {
  const hits: { op: string; key: string }[] = [];
  for (const [op, out] of schemas) {
    for (const key of schemaKeyNames(out)) {
      if (SECRET_KEY_RE.test(key)) hits.push({ op, key });
    }
  }
  return hits;
}

/**
 * A declaration that can turn ciphertext back into plaintext.
 *
 * Keyed on the DECLARED NAME, like `lint-no-builtin-capabilities` rule 2 and for the same
 * reason: matching "any function that returns a string from a SealedCredential" would fire
 * on `maskCredential` and get muted within a week. A reader named `xs` slips through -- and
 * is caught instead by the port review, since `ModelPoolRepository` has no method that
 * returns one (asserted below).
 */
const PLAINTEXT_READER_RE =
  /^\s*(?:export\s+)?(?:async\s+)?(?:function|const|let|interface|type|class)\s+\w*(?:unseal|decrypt|plaintext|revealCredential)\w*\b|^\s*(?:unseal|decrypt|plaintext|revealCredential)\w*\s*\(/i;

function plaintextReaders(root: string): string[] {
  const hits: string[] = [];
  for (const file of walkFiles(root)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        // A comment explaining why there is no decrypt is documentation of the rule, not a
        // violation of it -- the same exemption every other gate in this repo makes.
        if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
        if (PLAINTEXT_READER_RE.test(line)) hits.push(`${relative(root, file)}:${i + 1}`);
      });
  }
  return hits;
}

const cipher: CredentialCipher = {
  algorithm: "aes-256-gcm",
  keyId: "k-test-1",
  // Deliberately NOT a real cipher and deliberately not reversible in this file: the test
  // must not be able to demonstrate a decryption it claims does not exist. Base64 is enough
  // to prove the stored bytes are not the plaintext bytes.
  encrypt: (p) => Buffer.from(p, "utf8").toString("base64"),
};

describe("no response schema in the bundle can carry a credential (I-6, first defence)", () => {
  it("all 57 operations: zero secret-shaped response keys", () => {
    const hits = secretKeysInResponses(responseSchemas());
    expect(
      hits.map((h) => `${h.op}.${h.key}`),
      "a response schema declares a secret-shaped key",
    ).toEqual([]);
  });

  it("positive control: the scan is looking at a real, non-empty set of schemas", () => {
    // Without this, the assertion above passes against a contract that failed to import.
    expect(responseSchemas().size).toBeGreaterThan(40);
    const everyKey = new Set<string>();
    for (const [, out] of responseSchemas()) for (const k of schemaKeyNames(out)) everyKey.add(k);
    expect(everyKey.size).toBeGreaterThan(80);
  });

  it("counter-proof: the same scan CATCHES a planted `credential` in a response", () => {
    const planted = new Map<string, z.ZodTypeAny>([
      ["listModelPoolLeaky", z.object({ modelId: z.string(), credential: z.string() })],
      ["nestedLeak", z.object({ rows: z.array(z.object({ apiKey: z.string() })) })],
    ]);
    expect(secretKeysInResponses(planted).map((h) => `${h.op}.${h.key}`).sort()).toEqual([
      "listModelPoolLeaky.credential",
      "nestedLeak.apiKey",
    ]);
  });

  it("`endpointHint` is exempt because it is a two-value enum, and that is checked", () => {
    const row = C.McpServerRow as unknown as { shape: Record<string, z.ZodTypeAny> };
    const hint = row.shape.endpointHint!;
    const options = (hint as unknown as { options?: readonly string[] }).options ?? [];
    expect(options.length, "endpointHint stopped being an enum -- it can now carry an address")
      .toBeGreaterThan(0);
    expect(hint.safeParse("http://10.0.0.4:8000").success).toBe(false);
  });

  it("the two write-only fields go IN and are declared on no way out", () => {
    const inKeys = Object.keys(C.operations.registerModel.in.shape);
    expect(inKeys).toContain("credential");
    expect(inKeys).toContain("endpoint");
    const everyResponseKey = new Set<string>();
    for (const [, out] of responseSchemas()) for (const k of schemaKeyNames(out)) everyResponseKey.add(k);
    expect(everyResponseKey.has("credential")).toBe(false);
    expect(everyResponseKey.has("endpoint")).toBe(false);
  });
});

describe("nothing in apps/api/src can turn a sealed credential back into plaintext", () => {
  it("no plaintext reader is declared anywhere under src/", () => {
    expect(plaintextReaders(API_SRC), "a plaintext reader exists -- see the vault header").toEqual([]);
  });

  it("counter-proof: the scan CATCHES all three shapes in the leak fixture", () => {
    const hits = plaintextReaders(LEAK_FIXTURE);
    expect(hits.length, "the scan found nothing in a file written to be found").toBe(3);
    expect(hits.join(" ")).toContain("leaky-vault.ts");
  });

  it("the cipher port has an encrypt and no decrypt", () => {
    expect(Object.keys(cipher).sort()).toEqual(["algorithm", "encrypt", "keyId"]);
    const vault = readFileSync(join(API_SRC, "domain/model/credential-vault.ts"), "utf8");
    const declarations = vault
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      // `export` only: a local inside a function body is not part of the vault's surface.
      .filter((l) => /^export\s+(?:function|const)\s+\w+/.test(l))
      .map((l) => /\s(\w+)\s*[(:=]/.exec(l)?.[1])
      .filter((n): n is string => Boolean(n));
    expect(declarations.sort()).toEqual(
      ["CREDENTIAL_MASK", "hasCredential", "maskCredential", "redactSecrets", "sealCredential"].sort(),
    );
  });

  it("the repository port exposes no credential-returning method", () => {
    const ports = readFileSync(join(API_SRC, "application/model/ports.ts"), "utf8");
    const methods = [...ports.matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1]!);
    // `encrypt` is absent because the cipher port is RE-EXPORTED from the domain vault
    // rather than redeclared here -- one declaration, and it has no decrypt either.
    //
    // ⚠ This list is EXHAUSTIVE on purpose, which means adding a port to `ports.ts` turns
    // this red. That is the assertion working: it forces whoever adds a method to state, in
    // this diff, that it returns nothing credential-shaped. F49 added five --
    // `append` / `listForModel` (the admission log), `read` (a model's shape and member
    // ids), `setStatus`, `enableRejected` (the audit sink) -- and none of them touches
    // `model_secrets` or takes a `SealedCredential`. Reviewed and added here rather than
    // moved to a second ports file, which would have kept this test green by putting the new
    // surface outside its reach.
    // F50 added five more -- `read` (a SECOND overload name, kind + version for
    // `disableModel`'s optimistic check), `countOtherEnabledSelfHosted` (a count, not a
    // row), `snapshot` (the four reference lists + an in-flight count, all ids/numbers),
    // `disable` / `markDependencyFailed` / `applyCallPolicy` (writes that take ids, a mode
    // and a reason string). None of the five reads or returns a credential or endpoint.
    expect(methods.sort()).toEqual(
      [
        "append", "applyCallPolicy", "countOtherEnabledSelfHosted", "disable",
        "enableRejected", "forOrg", "insert", "listForModel", "listForOrg",
        "markDependencyFailed", "newModelId", "now", "read", "read", "setStatus", "snapshot",
      ].sort(),
    );
    expect(ports).toContain('export type { CredentialCipher } from "../../domain/model/credential-vault"');
  });
});

describe("what the vault does expose reveals nothing about the secret", () => {
  const sealed = sealCredential(PLAINTEXT, cipher, "2026-07-31T00:00:00.000Z");

  it("sealing keeps ciphertext, algorithm, keyId, sealedAt -- and no plaintext field", () => {
    expect(Object.keys(sealed).sort()).toEqual(
      ["__sealed", "algorithm", "ciphertext", "keyId", "sealedAt"].sort(),
    );
    expect(JSON.stringify(sealed)).not.toContain(PLAINTEXT);
    expect(sealed.ciphertext).not.toBe(PLAINTEXT);
  });

  it("the mask is a constant: no prefix, no tail, no length hint", () => {
    expect(maskCredential(sealed)).toBe(CREDENTIAL_MASK);
    // Two different secrets of two different lengths render identically. A last-four mask
    // would fail this, which is the point -- last-four is a disclosure decision nobody made.
    const other = sealCredential("x", cipher, "2026-07-31T00:00:00.000Z");
    expect(maskCredential(other)).toBe(maskCredential(sealed));
    expect(CREDENTIAL_MASK).not.toContain(PLAINTEXT.slice(-4));
    expect(maskCredential(null)).toBeNull();
    expect(hasCredential(sealed)).toBe(true);
    expect(hasCredential(null)).toBe(false);
  });

  it("an empty credential is refused rather than sealed into a convincing-looking record", () => {
    expect(() => sealCredential("", cipher, "2026-07-31T00:00:00.000Z")).toThrow();
  });
});

describe("the pool row has no credential under any role, because it has no role", () => {
  const input = {
    kind: "closed-api",
    shape: "single",
    vendor: "OpenAI",
    displayName: "pool-fixture-b",
    capabilityTags: ["推理"],
    contextWindow: 256_000,
    unitPrice: 0.06,
    complianceAttrs: [],
    credential: PLAINTEXT,
    endpoint: "https://api.example.invalid/v1",
    members: [],
  } satisfies RegisterModelInput;

  it("the projection drops both, and the whole serialised row contains neither", () => {
    const row = projectPoolRow(input, { modelId: "m-3", status: "待测试" });
    expect(Object.keys(row)).not.toContain("credential");
    expect(Object.keys(row)).not.toContain("endpoint");
    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain(PLAINTEXT);
    expect(serialised).not.toContain("api.example.invalid");
  });

  it("it cannot be told who is asking (I-6 「任何角色」)", () => {
    // Arity 2: the registration and the (modelId, status) pair. No principal, no role, no
    // "isAdmin" flag -- so there is no branch in which a credential could be included.
    expect(projectPoolRow.length).toBe(2);
    const source = readFileSync(join(API_SRC, "domain/model/registry.ts"), "utf8");
    const body = source.slice(source.indexOf("export function projectPoolRow"));
    expect(/isAdmin|principal|orgRole|requester/i.test(body.slice(0, 600))).toBe(false);
  });
});

describe("logs and audit rows (AC3's third surface)", () => {
  it("redaction removes the plaintext, and the un-redacted string proves it was there", () => {
    const line = `POST /models body={"displayName":"x","credential":"${PLAINTEXT}"}`;
    expect(line).toContain(PLAINTEXT); // positive control: the input really carries it
    const safe = redactSecrets(line, [PLAINTEXT]);
    expect(safe).not.toContain(PLAINTEXT);
    expect(safe).toContain(CREDENTIAL_MASK);
  });

  it("a secret that is a prefix of another leaves no tail behind", () => {
    const short = "sk-live-9f2b";
    const line = `a=${PLAINTEXT} b=${short}`;
    const safe = redactSecrets(line, [short, PLAINTEXT]);
    expect(safe).not.toContain(short);
    expect(safe).not.toContain(PLAINTEXT);
    // Order-independence is the property: shortest-first would have eaten the prefix of the
    // long one and left `-7c11-never-echo-me` in the log.
    expect(safe).toBe(redactSecrets(line, [PLAINTEXT, short]));
  });
});

describe("at rest: the application role can write a credential and cannot read one", () => {
  const sql = readFileSync(MIGRATION, "utf8")
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");

  function grantsFor(table: string): string {
    return (
      new RegExp(`GRANT\\s+([A-Z,\\s]+?)\\s+ON\\s+${table}\\s+TO\\s+app_rw`, "i").exec(sql)?.[1] ?? ""
    );
  }

  /** The column list of a `GRANT SELECT (a, b, c) ON <table>`, or null when there is none. */
  function selectColumnsFor(table: string): string[] | null {
    const m = new RegExp(`GRANT\\s+SELECT\\s*\\(([^)]*)\\)\\s*\\n?\\s*ON\\s+${table}\\s+TO\\s+app_rw`, "i").exec(sql);
    return m ? m[1]!.split(",").map((c) => c.trim()).filter(Boolean) : null;
  }

  it("model_secrets: the app role may read every column EXCEPT `ciphertext`", () => {
    // ## Why a column grant and not a table-wide denial
    //
    // The first version of this migration withheld SELECT on the whole table. CI proved that
    // wrong: this kernel has catalog-derived sweeps that `count(*)` every tenant table --
    // `PgOrgLifecycleRepository.tableCounts` builds the organization export manifest that way
    // (F22), and the cross-tenant leak assertions do too. Those sweeps are right to exist and
    // right to be derived; an export that silently omits a table is worse than one that fails.
    //
    // The requirement was never "unreadable", it is "the SECRET is unreadable" -- and a column
    // grant says exactly that. `count(*)` needs privilege on one column and gets `org_id`;
    // `SELECT ciphertext` and `SELECT *` both fail at the database.
    const cols = selectColumnsFor("model_secrets");
    expect(cols, "no column-level SELECT grant found -- this assertion would be vacuous").not.toBeNull();
    expect(cols).not.toContain("ciphertext");
    // The sweeps need this one specifically; without it `count(*)` is denied again.
    expect(cols).toContain("org_id");
    // Two-way: the granted set is pinned, so a later column is a deliberate decision rather
    // than something that rode in on a `*`.
    expect([...cols!].sort()).toEqual(
      ["algorithm", "key_id", "model_id", "org_id", "sealed_at", "secret_kind"],
    );
  });

  it("model_secrets: writes are granted, so it is usable at all", () => {
    const g = grantsFor("model_secrets");
    expect(g).toContain("INSERT");
    expect(g).toContain("UPDATE");
  });

  it("positive control: `models` gets a plain table-wide SELECT -- the column form is deliberate", () => {
    // Without this, "model_secrets has a column grant" could just be how this file writes
    // every grant, and the restriction would be saying nothing.
    expect(grantsFor("models")).toContain("SELECT");
    expect(selectColumnsFor("models"), "models should NOT need a column-level grant").toBeNull();
  });

  it("`ciphertext` is granted to nobody, in this migration or any other", () => {
    // The column is the whole security boundary, so the search is repo-wide over migrations
    // rather than over this file only: a later migration could hand it out.
    const all = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => ({ f, body: readFileSync(join(MIGRATIONS_DIR, f), "utf8") }));
    expect(all.length, "read no migrations -- this scan would be vacuous").toBeGreaterThan(10);
    const offenders = all.flatMap(({ f, body }) =>
      body
        .split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => !/^\s*--/.test(line))
        .filter(({ line }) => /GRANT[\s\S]*\bciphertext\b/i.test(line))
        .map(({ n }) => `${f}:${n}`),
    );
    expect(offenders, "a migration grants access to the ciphertext column").toEqual([]);
  });

  it("there is no plaintext column to have written into", () => {
    const table = /CREATE TABLE IF NOT EXISTS model_secrets \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? "";
    expect(table, "model_secrets table body not found").not.toBe("");
    expect(table).toContain("ciphertext");
    expect(/\bplaintext\b|\bcredential_value\b|\bsecret_value\b/i.test(table)).toBe(false);
  });

  it("the secrets table is RLS-protected like every other tenant table", () => {
    expect(sql).toContain("ALTER TABLE model_secrets ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE model_secrets FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("CREATE POLICY model_secrets_tenant");
  });
});
