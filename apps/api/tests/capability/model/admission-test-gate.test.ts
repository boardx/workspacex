/**
 * F49 · 五项全过才可启用 (I-1), and the five are the contract's five.
 *
 * ## ⚠ Why there is no `toHaveLength(5)` in this file
 *
 * `coding-standards` E-4 / 纪律 9: assert the PROPERTY, not the COUNT. A count is green for
 * the wrong reasons in both directions -- it passes when someone swaps 中文表达 for a sixth
 * item they invented and drops one, and it fails on a properly reviewed addition with a
 * message that diagnoses nothing. What is worth guarding is that THE SET the gate requires
 * equals THE SET the contract declares equals THE SET the database will accept, in both
 * directions, so that changing one and not the others goes red.
 *
 * ## ⚠ And why set equality alone is not enough either
 *
 * Two empty sets are equal. If `AdmissionTestItem` were emptied, every equality below would
 * still hold and `admissionGate` would return `ok` for a model with no verdicts at all --
 * green, and the gate wide open. That is this repository's most repeated failure (nine
 * recorded "全绿但空转"), so the emptiness is a named branch in the gate
 * (`ADMISSION_ITEMS_UNDECLARED`) and is asserted here directly.
 *
 * The last section drives `enableModel` itself, because the domain gate returning a refusal
 * is not the feature: 「直接调接口置为已启用被拒绝**并记审计**」 is.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentRuntime as C } from "@repo/contracts";
import {
  ADMISSION_ITEMS_UNDECLARED,
  ADMISSION_TEST_ITEMS,
  ADMISSION_TESTS_INCOMPLETE,
  ADMISSION_VERDICTS,
  admissionGate,
  latestVerdicts,
  PASSING_VERDICT,
  verdictHistory,
  type AdmissionTestItem,
  type AdmissionVerdict,
  type StoredAdmissionTest,
} from "../../../src/domain/model/admission";
import { enableModel, MODEL_NOT_FOUND } from "../../../src/application/model/enable-model";
import { enabledStatusHolds } from "../../../src/application/model/record-admission-test";
import type {
  AdmissionAuditSink,
  AdmissionTestRepository,
  ModelShapeReader,
  ModelStatusWriter,
} from "../../../src/application/model/ports";

const MIGRATION = fileURLToPath(
  new URL("../../../migrations/0031-f49-admission-tests.sql", import.meta.url),
);

/** Pull a CHECK's quoted literals out of the migration, so the SQL is read, not retyped. */
function checkLiterals(column: string): readonly string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const m = new RegExp(`${column}\\s+IN\\s*\\(([^)]*)\\)`, "s").exec(sql);
  if (m === null) throw new Error(`0031 has no \`${column} IN (...)\` CHECK`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

let seq = 0;
function judged(
  item: AdmissionTestItem,
  verdict: AdmissionVerdict,
  over: Partial<StoredAdmissionTest> = {},
): StoredAdmissionTest {
  seq += 1;
  return {
    recordId: `rec-${seq}`,
    modelId: "m-under-test",
    item,
    verdict,
    evidence: "见 evidence/2026-07-31-conn.log",
    judgedBy: "u-admin",
    judgedAt: new Date(1_760_000_000_000 + seq).toISOString(),
    seq,
    ...over,
  };
}

/** A complete, passing log -- the only input for which the gate is allowed to open. */
const allPassing = (): StoredAdmissionTest[] =>
  ADMISSION_TEST_ITEMS.map((item) => judged(item, "通过"));

describe("the five items are one set, declared once", () => {
  it("contract == domain == migration CHECK, in both directions", () => {
    const contract = [...C.AdmissionTestItem.options].sort();
    const domain = [...ADMISSION_TEST_ITEMS].sort();
    const sql = [...checkLiterals("item")].sort();
    // Three-way, and each comparison is two-way by construction: `toEqual` on sorted arrays
    // fails on an extra member as loudly as on a missing one.
    expect(domain).toEqual(contract);
    expect(sql).toEqual(contract);
  });

  it("the verdict enum is likewise one set, and `不适用` is one of three", () => {
    expect([...ADMISSION_VERDICTS].sort()).toEqual([...C.AdmissionVerdict.options].sort());
    expect([...checkLiterals("verdict")].sort()).toEqual([...C.AdmissionVerdict.options].sort());
    // The one that opens the gate, named once. `不适用` is deliberately not in it (I-1).
    expect(ADMISSION_VERDICTS).toContain(PASSING_VERDICT);
    expect(PASSING_VERDICT).toBe("通过");
  });

  it("an item the contract never declared is rejected by the contract itself", () => {
    expect(C.AdmissionTestItem.safeParse("响应速度").success).toBe(false);
    for (const item of ADMISSION_TEST_ITEMS) {
      expect(C.AdmissionTestItem.safeParse(item).success).toBe(true);
    }
  });

  /**
   * ⚠ The non-vacuity assertion. Everything above is satisfied by three empty sets.
   */
  it("neither side is empty, and an empty requirement is NOT a pass", () => {
    expect(ADMISSION_TEST_ITEMS.length).toBeGreaterThan(0);
    expect(checkLiterals("item").length).toBeGreaterThan(0);

    // Both sides empty: no items required, no verdicts recorded. Every "all required items
    // passed" loop is vacuously satisfied here, and the gate must still refuse.
    const vacuous = admissionGate([], []);
    expect(vacuous.ok).toBe(false);
    expect(vacuous.ok === false && vacuous.code).toBe(ADMISSION_ITEMS_UNDECLARED);
  });
});

describe("I-1:五项全过才可启用 -- each of the five, on its own", () => {
  it("the complete passing log opens the gate", () => {
    expect(admissionGate(allPassing()).ok).toBe(true);
  });

  /**
   * Five cases, generated from the set rather than transcribed: a sixth item added to the
   * contract is covered here the day it lands. Each case fails exactly one item and asserts
   * the gate names THAT item -- a gate that refused everything would pass a "refusal
   * expected" assertion while being useless.
   */
  for (const failing of ADMISSION_TEST_ITEMS) {
    it(`refuses when only 「${failing}」 is 不通过, and says which`, () => {
      const log = ADMISSION_TEST_ITEMS.map((item) =>
        judged(item, item === failing ? "不通过" : "通过"),
      );
      const gate = admissionGate(log);
      expect(gate.ok).toBe(false);
      if (gate.ok || gate.code !== ADMISSION_TESTS_INCOMPLETE) throw new Error("wrong branch");
      expect(gate.blocked.map((b) => b.item)).toEqual([failing]);
      expect(gate.blocked[0]).toMatchObject({ reason: "latest-verdict-not-passing", verdict: "不通过" });
    });

    it(`refuses when only 「${failing}」 was never judged, and says so differently`, () => {
      const log = ADMISSION_TEST_ITEMS.filter((i) => i !== failing).map((i) => judged(i, "通过"));
      const gate = admissionGate(log);
      expect(gate.ok).toBe(false);
      if (gate.ok || gate.code !== ADMISSION_TESTS_INCOMPLETE) throw new Error("wrong branch");
      // "never judged" and "judged and failed" get different remedies, so they get
      // different reasons. Collapsing them would tell the admin to re-run a test that was
      // never run, or to look for a failure that does not exist.
      expect(gate.blocked).toEqual([{ item: failing, reason: "never-judged" }]);
    });

    it(`「${failing}」 marked 不适用 does NOT count as passing`, () => {
      const log = ADMISSION_TEST_ITEMS.map((item) =>
        judged(item, item === failing ? "不适用" : "通过"),
      );
      const gate = admissionGate(log);
      expect(gate.ok).toBe(false);
      if (gate.ok || gate.code !== ADMISSION_TESTS_INCOMPLETE) throw new Error("wrong branch");
      expect(gate.blocked).toEqual([
        { item: failing, reason: "latest-verdict-not-passing", verdict: "不适用" },
      ]);
    });
  }

  it("an empty log names every one of the five, not just the first", () => {
    const gate = admissionGate([]);
    if (gate.ok || gate.code !== ADMISSION_TESTS_INCOMPLETE) throw new Error("wrong branch");
    // Set equality against the required set -- again a property, not a count. An
    // implementation that returned after the first miss would name one item and leave the
    // admin to discover the other four one enable attempt at a time.
    expect([...gate.blocked.map((b) => b.item)].sort()).toEqual([...ADMISSION_TEST_ITEMS].sort());
  });

  it("a refusal always names at least one item", () => {
    // The property behind 「必须指出卡在哪一项」: there is no input for which the gate
    // refuses and explains nothing.
    for (const verdict of ADMISSION_VERDICTS) {
      const log = ADMISSION_TEST_ITEMS.map((i) => judged(i, verdict));
      const gate = admissionGate(log);
      if (gate.ok) {
        expect(verdict).toBe(PASSING_VERDICT);
        continue;
      }
      if (gate.code !== ADMISSION_TESTS_INCOMPLETE) throw new Error("wrong branch");
      expect(gate.blocked.length).toBeGreaterThan(0);
    }
  });
});

describe("改判：the latest verdict decides, the older one survives", () => {
  it("a later 通过 over an earlier 不通过 opens the gate, and both records remain", () => {
    const first = judged("工具调用", "不通过", { evidence: "第一次：函数名被截断" });
    const rest = ADMISSION_TEST_ITEMS.filter((i) => i !== "工具调用").map((i) => judged(i, "通过"));
    const second = judged("工具调用", "通过", { evidence: "复测：升级 SDK 后正常" });
    const log = [first, ...rest, second];

    expect(admissionGate(log).ok).toBe(true);
    // The point of I-7: the log still holds both, and `seq` says which is which.
    const history = verdictHistory(log, "工具调用");
    expect(history.map((r) => r.verdict)).toEqual(["不通过", "通过"]);
    expect(history[0]!.seq).toBeLessThan(history[1]!.seq);
    expect(latestVerdicts(log).get("工具调用")!.recordId).toBe(second.recordId);
  });

  it("a later 不通过 over an earlier 通过 closes it again", () => {
    const log = [...allPassing(), judged("长上下文", "不通过", { evidence: "128k 处截断" })];
    const gate = admissionGate(log);
    expect(gate.ok).toBe(false);
    if (gate.ok || gate.code !== ADMISSION_TESTS_INCOMPLETE) throw new Error("wrong branch");
    expect(gate.blocked.map((b) => b.item)).toEqual(["长上下文"]);
  });

  it("order in the array does not decide -- `seq` does", () => {
    // A store that returned rows in an arbitrary order (no ORDER BY, a parallel fetch, a
    // cache) must not change the verdict. "Last element wins" would pass every test above
    // and flip on the day someone drops the ORDER BY.
    const early = judged("中文表达", "不通过");
    const late = judged("中文表达", "通过");
    const rest = ADMISSION_TEST_ITEMS.filter((i) => i !== "中文表达").map((i) => judged(i, "通过"));
    expect(admissionGate([late, ...rest, early]).ok).toBe(true);
    expect(latestVerdicts([late, early]).get("中文表达")!.recordId).toBe(late.recordId);
  });

  it("`enabledStatusHolds` catches a status the log no longer justifies", () => {
    // The stated gap: uc-20-1 E3's disable cascade does not exist yet, so a downgrade
    // leaves `status` behind. This makes the discrepancy detectable instead of invisible.
    const downgraded = [...allPassing(), judged("结构化输出", "不通过")];
    expect(enabledStatusHolds("已启用", downgraded)).toBe(false);
    expect(enabledStatusHolds("已启用", allPassing())).toBe(true);
    expect(enabledStatusHolds("待测试", downgraded)).toBe(true);
  });
});

/* ─────────── the use case: a refusal is a WRITE, not just a return value ─────────── */

function fakes(records: readonly StoredAdmissionTest[], shape: "single" | "composite" = "single") {
  const written: { modelId: string; status: string }[] = [];
  const audited: { modelId: string; code: string; detail: Record<string, unknown> }[] = [];
  const admissions: AdmissionTestRepository = {
    append: () => Promise.reject(new Error("not used")),
    listForModel: (_org, modelId) =>
      Promise.resolve(records.filter((r) => r.modelId === modelId || modelId === "m-under-test")),
  };
  const models: ModelShapeReader = {
    read: (_org, modelId) =>
      Promise.resolve(modelId === "m-under-test" ? { shape, memberIds: [] } : null),
  };
  const status: ModelStatusWriter = {
    setStatus: (_org, modelId, s) => {
      written.push({ modelId, status: s });
      return Promise.resolve();
    },
  };
  const audit: AdmissionAuditSink = {
    enableRejected: (e) => {
      audited.push({ modelId: e.modelId, code: e.code, detail: e.detail as Record<string, unknown> });
      return Promise.resolve();
    },
  };
  return { deps: { admissions, models, status, audit }, written, audited };
}

describe("enableModel: 直接调接口置为已启用被拒绝并记审计", () => {
  it("opens and writes 已启用 when all five pass", async () => {
    const f = fakes(allPassing());
    const r = await enableModel("org-1", "m-under-test", "u-admin", f.deps);
    expect(r.ok).toBe(true);
    expect(f.written).toEqual([{ modelId: "m-under-test", status: "已启用" }]);
    // Non-vacuity for the audit assertions below: the success path writes NO audit entry,
    // so "an entry exists" in the refusal tests is caused by the refusal.
    expect(f.audited).toEqual([]);
  });

  it("refuses a bypassing call and records an audit entry naming the blocked item", async () => {
    const log = ADMISSION_TEST_ITEMS.map((i) => judged(i, i === "连通性" ? "不通过" : "通过"));
    const f = fakes(log);
    const r = await enableModel("org-1", "m-under-test", "u-bypass", f.deps);

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("wrong branch");
    expect(r.code).toBe(ADMISSION_TESTS_INCOMPLETE);
    expect(r.blocked.map((b) => b.item)).toEqual(["连通性"]);

    // ⚠ The status must NOT have moved. A refusal that returns an error after writing is
    // the failure this gate exists to prevent.
    expect(f.written).toEqual([]);
    // ...and the attempt is on the record, with the same detail the caller got.
    expect(f.audited).toHaveLength(1);
    expect(f.audited[0]!.code).toBe(ADMISSION_TESTS_INCOMPLETE);
    expect((f.audited[0]!.detail as { blocked: { item: string }[] }).blocked.map((b) => b.item)).toEqual([
      "连通性",
    ]);
  });

  it("an unrecordable refusal is not a successful refusal", async () => {
    const f = fakes([]);
    const boom = new Error("audit sink down");
    const deps = { ...f.deps, audit: { enableRejected: () => Promise.reject(boom) } };
    // The audit write is awaited and its failure propagates. If it were fire-and-forget,
    // this call would resolve to a tidy refusal with nothing written anywhere.
    await expect(enableModel("org-1", "m-under-test", "u", deps)).rejects.toThrow("audit sink down");
    expect(f.written).toEqual([]);
  });

  it("an unknown model is refused and audited too", async () => {
    const f = fakes(allPassing());
    const r = await enableModel("org-1", "m-nonexistent", "u", f.deps);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("wrong branch");
    expect(r.code).toBe(MODEL_NOT_FOUND);
    expect(f.audited.map((a) => a.code)).toEqual([MODEL_NOT_FOUND]);
    expect(f.written).toEqual([]);
  });

  it("the wire code stays inside the contract's declared error set", () => {
    // `contract-design.md` §五: an agent may not widen a contract awaiting sign-off. The
    // domain draws finer distinctions (`domainCode`); what crosses the boundary must be one
    // of the four `enableModel.err` already declares.
    expect([...C.operations.enableModel.err]).toContain(ADMISSION_TESTS_INCOMPLETE);
  });
});

/* ────────────── the lint exemption, made load-bearing rather than claimed ────────────── */

/**
 * `lint-permission-paths.mjs` allowlists `pg-admission-test-repository.ts`, because a model
 * has no `acl_bindings` row and pushing one through `authorize` would ALLOW EVERY MEMBER --
 * the failure `toAclRef` throws on for `capability` / `organization` / `interview`.
 *
 * Every other entry on that allowlist is pinned by a test that fails if the exemption stops
 * being true. This is that test. Its (d) is the one that matters: the exemption rests on
 * there being no disclosure surface above this file yet, so the day a controller reaches it,
 * this goes red and the org-admin decision has to be attached there.
 */
describe("the read path exemption is bounded", () => {
  const REPO_PATH = fileURLToPath(
    new URL("../../../src/infrastructure/model/pg-admission-test-repository.ts", import.meta.url),
  );
  const SRC = fileURLToPath(new URL("../../../src", import.meta.url));
  const repoSource = readFileSync(REPO_PATH, "utf8");

  it("(a) every statement in the file names only `model_admission_tests`", () => {
    const tables = [...repoSource.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)/g)].map(
      (m) => m[1]!,
    );
    expect([...new Set(tables)]).toEqual(["model_admission_tests"]);
    // Non-vacuity: a regex that matched nothing would satisfy `toEqual` on an empty array
    // in a file with no SQL at all.
    expect(tables.length).toBeGreaterThan(0);
  });

  it("(b) it never reads outside a tenant transaction", () => {
    expect(repoSource).not.toContain("withoutTenant");
    expect(repoSource).toContain("withTenant");
  });

  it("(c) it returns no key outside `AdmissionTestRecord` plus `seq`", () => {
    // Read off the contract, not transcribed -- a field added to `AdmissionTestRecord`
    // arrives here without editing this test, and a field this repository invents does not.
    const allowed = new Set([...Object.keys(C.AdmissionTestRecord.shape), "seq"]);
    const projection = /const toRecord[\s\S]*?^\}\);$/m.exec(repoSource);
    expect(projection, "the projection function moved; re-point this assertion").not.toBeNull();
    const emitted = [...projection![0].matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]!);
    expect(emitted.length).toBeGreaterThan(0);
    for (const key of emitted) expect(allowed.has(key), `unexpected key \`${key}\``).toBe(true);
    // ...and nothing credential-shaped, whatever it is called.
    expect(repoSource).not.toMatch(/credential|ciphertext|endpoint|model_secrets/i);
  });

  it("(d) nothing under src/interface/ reaches it", () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    walk(join(SRC, "interface"));
    // Non-vacuity: an empty interface layer would make this pass while proving nothing.
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(
        readFileSync(f, "utf8"),
        `${f} reaches the admission repository -- the lint exemption assumed nothing did. ` +
          `Attach the org-admin decision there and remove the allowlist entry.`,
      ).not.toContain("pg-admission-test-repository");
    }
  });

  it("the allowlist entry exists and names this test", () => {
    // The other direction: if someone deletes the entry, the lint is the thing that goes
    // red. If someone deletes THIS test, nothing would -- so the entry's text is asserted
    // to point back here.
    const lint = readFileSync(
      fileURLToPath(new URL("../../../scripts/lint-permission-paths.mjs", import.meta.url)),
      "utf8",
    );
    expect(lint).toContain("src/infrastructure/model/pg-admission-test-repository.ts");
    expect(lint).toContain("tests/capability/model/admission-test-gate.test.ts");
  });
});
