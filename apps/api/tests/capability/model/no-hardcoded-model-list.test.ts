/**
 * F48 · the model half of F15's acceptance V1 -- "产品代码删清单后仍能跑、空配置见空态"
 * (uc-20-1 R6, uc-0-5 R12 V1).
 *
 * ## Why this is not a second copy of `no-builtin-capability-lists.test.ts`
 *
 * That gate (F15) enforces rule 1 on the prototype's six AGENT names and rule 2 on
 * list-shaped constants. It has no needle for the eighteen MODEL names -- `lint-no-builtin-
 * capabilities.mjs` names Ava / Atlas / Scout / Ledger / Warden / Echo and nothing else -- so
 * `gpt-5.2` in a source file passes it today. This file closes that half, and it closes it
 * without writing a second list: the needles are DERIVED at test time from the prototype's
 * own mock, so the day the mock changes the scan follows it.
 *
 * The SQL half is the same arrangement: F15's rule 3 forbids INSERTs into
 * `capability_listings`; this asserts the same about `models` / `model_composite_members` /
 * `model_secrets`, which that gate has never heard of.
 *
 * ## V1's own warning, applied here
 *
 * "只验证配置能被读取、而不验证没有内置兜底，等于让第二个客户发现清单一直是硬编码的."
 * So there are two halves and both are needed: a STATIC scan (no list exists in the source
 * at all) and a RUNTIME two-way assertion (an empty organization gets an empty pool, and a
 * configured one gets exactly what it configured). A fallback that lives on a branch is
 * invisible to the first; a hardcoded list that is never reached is invisible to the second.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isEmptyPool, listModelPool } from "../../../src/application/model/list-model-pool";
import { checkComplianceAttrs } from "../../../src/domain/model/compliance-attrs";
import type { ModelPoolRepository, StoredModel } from "../../../src/application/model/ports";
import type { ModelPoolRow } from "../../../src/domain/model/registry";

const REPO_ROOT = fileURLToPath(new URL("../../../../..", import.meta.url));
const MOCK_ADMIN = join(REPO_ROOT, "apps/web/lib/mock/admin.ts");
const MIGRATIONS = join(REPO_ROOT, "apps/api/migrations");
const BUILTIN_FIXTURE = join(REPO_ROOT, "apps/api/__fixtures__/f48-builtin-models");

/**
 * Where a built-in list would live if it existed. `apps/web/lib/mock/` is excluded because
 * it IS the prototype's hand-written data -- known, counted debt (see
 * `lint-no-builtin-capabilities.mjs`'s DEBT_PREFIXES), and the source these needles come
 * from. Excluding it here is not an exemption: it is not scanning the ruler for marks.
 */
const PRODUCT_ROOTS = [
  "apps/api/src",
  "packages/contracts/src",
  "apps/web/app",
  "apps/web/components",
];
const EXCLUDED_PREFIXES = ["apps/web/lib/mock/", "apps/web/lib/generated/"];

function walkTs(dir: string, out: string[] = []): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out;
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === ".next" || n.startsWith(".")) continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walkTs(p, out) : /\.tsx?$/.test(n) && out.push(p);
  }
  return out;
}

/** The prototype's model names, read off its own mock rather than transcribed. */
function prototypeModelNames(): string[] {
  const body = readFileSync(MOCK_ADMIN, "utf8");
  const block = /export const MODELS[\s\S]*?\n\];/.exec(body)?.[0] ?? "";
  return [...block.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]!);
}

/** Occurrences of any needle in product code, as `path:line  needle`. */
function needleHits(roots: readonly string[], needles: readonly string[]): string[] {
  const hits: string[] = [];
  for (const root of roots) {
    for (const file of walkTs(join(REPO_ROOT, root))) {
      const rel = relative(REPO_ROOT, file);
      if (EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          // A comment naming a model is documentation of the rule (this file's own headers
          // do it) -- the same exemption every gate in this repo makes for comments.
          if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
          for (const needle of needles) {
            if (line.includes(`"${needle}"`) || line.includes(`'${needle}'`)) {
              hits.push(`${rel}:${i + 1}  ${needle}`);
            }
          }
        });
    }
  }
  return hits;
}

describe("the prototype's eighteen models exist in no product source file", () => {
  const needles = prototypeModelNames();

  it("the needles were actually derived (an empty needle list scans for nothing)", () => {
    expect(needles.length, "read no model names out of the prototype mock").toBeGreaterThan(10);
    expect(needles).toContain("qwen3-32b");
    expect(needles).toContain("gpt-5.2");
  });

  it("the only hits in product code are the one registered piece of prototype debt", () => {
    // ⚠ This scan found a REAL violation on its first run, and it is not F48's to fix:
    // `apps/web/components/chat/approval-card.tsx` mints `{ id: "qwen3-32b", label: "本地
    // qwen3-32b" }` inside its re-parameterise handler. That is a product component
    // inventing one organization's model out of a literal -- exactly uc-20-1 R6's failure --
    // but it belongs to the `chat` bundle's approval card, not to the model pool, and this
    // branch may not reach across into another bundle's feature.
    //
    // So it is REGISTERED rather than excused, and registered as an exact set: adding a
    // second hardcoded model fails this test, and fixing this one also fails it (with a
    // message telling you to delete the entry). A `.filter(not-this-file)` exemption would
    // have done neither.
    const KNOWN_PROTOTYPE_DEBT = ["apps/web/components/chat/approval-card.tsx  qwen3-32b"];
    const hits = needleHits(PRODUCT_ROOTS, needles).map((h) => h.replace(/:\d+ /, " "));
    expect(
      [...new Set(hits)].sort(),
      "either a new hardcoded model appeared, or the registered one was fixed and its entry must go",
    ).toEqual(KNOWN_PROTOTYPE_DEBT);
  });

  it("apps/api/src and packages/contracts/src are clean with no exemption at all", () => {
    // The debt above is confined to the prototype console. The backend and the contract --
    // the two surfaces F48 delivers -- carry zero tolerance and no allowlist.
    expect(needleHits(["apps/api/src", "packages/contracts/src"], needles)).toEqual([]);
  });

  it("counter-proof: the same scan CATCHES the planted fixture", () => {
    const hits = needleHits(["apps/api/__fixtures__/f48-builtin-models"], needles);
    expect(hits.length, "the scan found nothing in a file written to be found").toBeGreaterThan(1);
    expect(hits.join(" ")).toContain("seeded-pool.ts");
    expect(hits.join(" ")).toContain("qwen3-32b");
  });

  it("the fixture also demonstrates the FALLBACK shape a static scan alone would miss", () => {
    // `rows.length === 0 ? STARTER_POOL : rows` -- the branch the runtime half below exists
    // to catch. Asserted here so the two halves are visibly aimed at different failures.
    const fixture = readFileSync(join(BUILTIN_FIXTURE, "seeded-pool.ts"), "utf8");
    expect(fixture).toContain("rows.length === 0 ? STARTER_POOL : rows");
  });
});

describe("no migration seeds the pool (F15 rule 3, applied to the model tables)", () => {
  const TABLES = ["models", "model_composite_members", "model_secrets"];

  function seedingLines(sql: string, file: string): string[] {
    const hits: string[] = [];
    sql.split("\n").forEach((line, i) => {
      if (/^\s*--/.test(line)) return;
      for (const t of TABLES) {
        if (new RegExp(`INSERT\\s+INTO\\s+${t}\\b`, "i").test(line)) hits.push(`${file}:${i + 1} ${t}`);
      }
    });
    return hits;
  }

  it("every migration is read, and none of them inserts a model", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
    expect(files.length, "no migration was read -- this gate is idling").toBeGreaterThan(10);
    expect(files).toContain("0019-f48-model-pool.sql");
    const hits = files.flatMap((f) => seedingLines(readFileSync(join(MIGRATIONS, f), "utf8"), f));
    expect(hits, "a migration seeds the model pool").toEqual([]);
  });

  it("counter-proof: the SQL scan CATCHES a seed statement", () => {
    const planted = "-- comment INSERT INTO models\nINSERT INTO models (id) VALUES ('m-gpt52');";
    expect(seedingLines(planted, "planted.sql")).toEqual(["planted.sql:2 models"]);
  });
});

describe("an organization with no configuration sees an empty state, not a default set", () => {
  function repositoryReturning(rows: readonly StoredModel[]): ModelPoolRepository & { calls: number } {
    const repo = {
      calls: 0,
      async insert() {
        throw new Error("not used in this test");
      },
      async listForOrg() {
        repo.calls += 1;
        return rows;
      },
    };
    return repo;
  }

  const row = (modelId: string): StoredModel => ({
    row: {
      modelId,
      status: "已启用",
      kind: "self-hosted",
      shape: "single",
      vendor: "自托管",
      displayName: modelId,
      capabilityTags: [],
      contextWindow: 128_000,
      unitPrice: 0,
      complianceAttrs: [],
      members: [],
    } as ModelPoolRow,
    credentialConfigured: false,
  });

  it("empty configuration ⇒ empty pool, and `isEmptyPool` says so", async () => {
    const repo = repositoryReturning([]);
    const pool = await listModelPool("org-fresh", repo);
    expect(pool).toEqual([]);
    expect(isEmptyPool(pool)).toBe(true);
    // The repository WAS consulted -- an empty result that came from not asking would look
    // identical, and would still be there once a fallback was added.
    expect(repo.calls).toBe(1);
  });

  it("positive control: a configured organization gets exactly what it configured", async () => {
    const repo = repositoryReturning([row("m-a"), row("m-b")]);
    const pool = await listModelPool("org-configured", repo);
    expect(pool.map((p) => p.row.modelId)).toEqual(["m-a", "m-b"]);
    expect(isEmptyPool(pool)).toBe(false);
  });

  it("the source has no fallback branch at all", () => {
    const src = readFileSync(
      join(REPO_ROOT, "apps/api/src/application/model/list-model-pool.ts"),
      "utf8",
    );
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    expect(/DEFAULT|STARTER|SEED|fallback/i.test(code)).toBe(false);
    expect(code).not.toContain("length === 0 ?");
  });
});

describe("the compliance vocabulary is configuration too (O-38 / I-8)", () => {
  it("with an empty vocabulary, an empty submission is accepted", () => {
    // O-38's ruling is that the vocabulary being empty must not block coding, so `[]` is a
    // valid model. This is the half people forget when they reach for a seeded enum.
    expect(checkComplianceAttrs([], [])).toEqual({ ok: true, attrs: [] });
  });

  it("with an empty vocabulary, any value is COMPLIANCE_ATTR_UNKNOWN -- empty is not a wildcard", () => {
    const r = checkComplianceAttrs(["境内"], []);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe("COMPLIANCE_ATTR_UNKNOWN");
    expect(r.ok === false && r.unknown).toEqual(["境内"]);
  });

  it("every unknown value is reported, not just the first", () => {
    const r = checkComplianceAttrs(["a", "b", "c"], ["b"]);
    expect(r.ok === false && r.unknown).toEqual(["a", "c"]);
  });

  it("the module knows no values of its own", () => {
    const src = readFileSync(
      join(REPO_ROOT, "apps/api/src/domain/model/compliance-attrs.ts"),
      "utf8",
    );
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    // The only string literal in the executable body is the error code itself.
    const literals = [...code.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
    expect(literals).toEqual(["COMPLIANCE_ATTR_UNKNOWN"]);
    // …and the vocabulary arrives as a parameter, which is what makes that true.
    expect(checkComplianceAttrs.length).toBe(2);
  });
});
