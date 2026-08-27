/**
 * F48 · the model pool row carries what uc-20-1 R7 says it carries, and nothing else.
 *
 * ## What this file refuses to do
 *
 * It does not decide the two registered divergences. `ModelKind` is `closed-api |
 * self-hosted` in the contract and `hosted-api | self-hosted` in the prototype's mock;
 * `ModelStatus` is four Chinese values in the contract, three English ones in the mock, and
 * F48's own prose names three. Which side is right is a sign-off question
 * (`apps/web/lib/contract-divergences.ts` D01 / D02), so what is asserted here is that the
 * divergence is still REGISTERED and still says what it says -- so that resolving it in one
 * place and not the others fails this test instead of passing quietly.
 *
 * ## Why enum assertions are set equality and not `toHaveLength`
 *
 * `coding-standards` revision E-4: the closedness of an enum is the property worth guarding,
 * the member COUNT is not. `toHaveLength(4)` turns a properly reviewed addition into a test
 * failure with no diagnosis, so the shape used here is: the member set equals the contract's,
 * and an undeclared value is rejected.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { agentRuntime as C } from "@repo/contracts";
import {
  CREDENTIAL_BEARING_FIELDS,
  INITIAL_MODEL_STATUS,
  MODEL_KINDS,
  MODEL_POOL_ROW_FIELDS,
  MODEL_SHAPES,
  MODEL_STATUSES,
  POOL_LISTING_GAP,
  projectPoolRow,
  responseSchemas,
  schemaKeyNames,
  type RegisterModelInput,
} from "../../../src/domain/model/registry";

const DIVERGENCES = fileURLToPath(
  new URL("../../../../web/lib/contract-divergences.ts", import.meta.url),
);

/** A registration that exercises every field, so a dropped one shows up as `undefined`. */
function sampleInput(over: Partial<RegisterModelInput> = {}): RegisterModelInput {
  return {
    kind: "self-hosted",
    shape: "single",
    vendor: "自托管 · A100×2",
    displayName: "pool-fixture-a",
    capabilityTags: ["推理", "中文"],
    contextWindow: 128_000,
    unitPrice: 0.06,
    complianceAttrs: [],
    credential: "sk-plaintext-must-not-survive",
    endpoint: "http://10.0.0.4:8000/v1",
    members: [],
    ...over,
  };
}

describe("the registry fields uc-20-1 R7 names are the contract's, once", () => {
  it("registerModel.in declares every field the admin list shows", () => {
    const declared = new Set(Object.keys(C.operations.registerModel.in.shape));
    // Two-way: the seven the feature names must be present, and the input must not have
    // grown a field this test has never heard of. A one-way check passes while the contract
    // sprouts an eighth that nothing renders.
    const named = [
      "kind",
      "vendor",
      "capabilityTags",
      "contextWindow",
      "unitPrice",
      "complianceAttrs",
      "shape",
    ];
    for (const f of named) expect(declared.has(f), `contract lost \`${f}\``).toBe(true);
    expect([...declared].sort()).toEqual(
      [...named, "displayName", "credential", "endpoint", "members"].sort(),
    );
  });

  it("the pool row is the registration minus exactly the two write-only fields", () => {
    expect([...MODEL_POOL_ROW_FIELDS].sort()).toEqual(
      Object.keys(C.operations.registerModel.in.shape)
        .filter((f) => !(CREDENTIAL_BEARING_FIELDS as readonly string[]).includes(f))
        .sort(),
    );
    const row = projectPoolRow(sampleInput(), { modelId: "m-1", status: "待测试" });
    expect(Object.keys(row).sort()).toEqual([...MODEL_POOL_ROW_FIELDS, "modelId", "status"].sort());
    expect(row.vendor).toBe("自托管 · A100×2");
    expect(row.contextWindow).toBe(128_000);
    expect(row.unitPrice).toBe(0.06);
    expect(row.capabilityTags).toEqual(["推理", "中文"]);
  });

  it("counter-proof: a field planted on the input does NOT reach the row", () => {
    // The projection is a whitelist, so an unknown key cannot ride along. Written as a
    // planted key rather than trusted from the implementation comment: a `delete
    // row.credential` blacklist passes every assertion above and fails this one.
    const smuggled = { ...sampleInput(), secretHeader: "x-api-key: live" } as RegisterModelInput;
    const row = projectPoolRow(smuggled, { modelId: "m-2", status: "待测试" });
    expect(Object.keys(row)).not.toContain("secretHeader");
  });

  it("a freshly registered model is 待测试 -- I-1 leaves it no other state", () => {
    expect(INITIAL_MODEL_STATUS).toBe("待测试");
    expect(C.ModelStatus.safeParse(INITIAL_MODEL_STATUS).success).toBe(true);
    // enableModel demands the five verdicts, so `已启用` on arrival would be unreachable
    // state. Asserted through the contract's own error list rather than restated.
    expect(C.operations.enableModel.err).toContain("ADMISSION_TESTS_INCOMPLETE");
  });
});

describe("the three enums are closed, and closed is asserted as a SET", () => {
  const cases: readonly [string, readonly string[], z.ZodEnum<[string, ...string[]]>, string][] = [
    ["ModelKind", MODEL_KINDS, C.ModelKind, "hosted-api"],
    ["ModelShape", MODEL_SHAPES, C.ModelShape, "pipeline"],
    ["ModelStatus", MODEL_STATUSES, C.ModelStatus, "未启用"],
  ];

  for (const [name, derived, schema, undeclared] of cases) {
    it(`${name}: members equal the contract's, and \`${undeclared}\` is refused`, () => {
      expect([...derived].sort()).toEqual([...schema.options].sort());
      expect(derived.length, `${name} read as empty -- the assertions would be vacuous`)
        .toBeGreaterThan(1);
      // The property worth guarding: an undeclared value cannot pass. Note the samples are
      // the OTHER side of the live divergences (`hosted-api`, `未启用`), which is what makes
      // "the two sides are not interchangeable" a fact this test states rather than assumes.
      expect(schema.safeParse(undeclared).success).toBe(false);
    });
  }
});

describe("the divergences stay registered until a human rules on them", () => {
  const registry = readFileSync(DIVERGENCES, "utf8");

  it("D01 still records that the prototype says `hosted-api` where the contract says `closed-api`", () => {
    expect(registry).toContain('contractType: "ModelKind"');
    expect(registry).toContain('"hosted-api"');
    // If the entry is deleted, the ruling has been made -- and this test must be revisited
    // together with the mock, the migration's CHECK and F48's prose. That is the point.
    expect(C.ModelKind.safeParse("hosted-api").success).toBe(false);
  });

  it("D02 still records the missing 依赖失败, and F48's own prose is the third version", () => {
    expect(registry).toContain('contractType: "ModelStatus"');
    expect(registry).toContain("依赖失败");
    expect(C.ModelStatus.options).toContain("依赖失败");
    // F48's user_visible_behavior says 已启用 / 未启用 / 待测试. `未启用` is in neither the
    // contract nor the mock's Chinese labels as a stored value -- the mock renders
    // `disabled` as 未启用 while the contract stores 已停用. Three spellings of one state.
    expect(C.ModelStatus.safeParse("未启用").success).toBe(false);
    // F48 itself is `passing` and may have been relocated into `feature_list.archive.json`
    // by the archiving script (`.harness/scripts/archive-passing.ts`) -- that relocation is
    // meant to be lossless bookkeeping (slim the actively-worked file, keep the history),
    // not a deletion. This test's whole point is "the divergence stays visible until a human
    // rules on it", so it has to keep finding F48's prose regardless of which of the two
    // files currently holds it.
    expect(readFeatureListAndArchive()).toContain("已启用/未启用/待测试");
  });
});

describe("the pool's listing gap is closed by `listModelPool` (#1381), and reconciled", () => {
  it("POOL_LISTING_GAP is now empty -- `listModelPool.out` returns every previously-missing field", () => {
    // Before #1381 this equaled ["capabilityTags", "contextWindow", "members", "unitPrice",
    // "vendor"] -- the tripwire the original comment described. The day a listing operation
    // appeared, that assertion was meant to fail and force reconciliation rather than let a
    // second definition of "what the admin list shows" grow quietly. This is that
    // reconciliation: `listModelPool.out`'s element carries all five, so the derived gap
    // (computed off `responseSchemas()`, not hand-maintained) now closes to nothing.
    expect([...POOL_LISTING_GAP]).toEqual([]);
  });

  it("`listModelPool.out` is exactly the pool row plus `credentialConfigured` -- no credential, no endpoint", () => {
    const row = schemaKeyNames(C.operations.listModelPool.out);
    // `schemaKeyNames` walks INTO `members` (an array of `CompositeMember`), so its own
    // `role` key rides along -- that is the walker doing its job (registry-fields' third
    // test already leans on this to catch a walker that stops at arrays), not a leak: `role`
    // is a plain string naming a composite member's part, nothing secret-shaped about it.
    expect([...row].sort()).toEqual(
      [...MODEL_POOL_ROW_FIELDS, "modelId", "status", "credentialConfigured", "role"].sort(),
    );
    for (const secret of CREDENTIAL_BEARING_FIELDS) {
      expect(row.has(secret), `\`listModelPool\` leaked \`${secret}\``).toBe(false);
    }
  });

  it("`listSelectableModels` is the PICKER, not the admin list (I-2)", () => {
    const candidate = schemaKeyNames(C.operations.listSelectableModels.out);
    expect([...candidate].sort()).toEqual(
      ["complianceAttrs", "displayName", "kind", "modelId", "shape"].sort(),
    );
    for (const adminOnly of ["unitPrice", "vendor", "contextWindow"]) {
      expect(candidate.has(adminOnly), `the picker leaked \`${adminOnly}\``).toBe(false);
    }
  });

  it("the response walk is not idling: it finds keys in the operations it is pointed at", () => {
    // A walker that returned nothing would make POOL_LISTING_GAP equal every input field and
    // read as a clean, complete finding. 57 operations must yield a large key set.
    const all = new Set<string>();
    for (const [, out] of responseSchemas()) for (const k of schemaKeyNames(out)) all.add(k);
    expect(responseSchemas().size).toBeGreaterThan(40);
    expect(all.size, "the schema walk found nothing -- every assertion above is vacuous")
      .toBeGreaterThan(80);
    expect(all.has("modelId")).toBe(true);
  });
});

function featureListPath(): string {
  return fileURLToPath(
    new URL(
      "../../../../../phases/phase-01-run-a-project/feature_list.json",
      import.meta.url,
    ),
  );
}

function featureListArchivePath(): string {
  return fileURLToPath(
    new URL(
      "../../../../../phases/phase-01-run-a-project/feature_list.archive.json",
      import.meta.url,
    ),
  );
}

/**
 * Concatenated content of the live feature list and its archive (if one exists yet --
 * older checkouts/branches predating the archiving script have none). A `passing` feature
 * moving from one file to the other is bookkeeping, not a content change; any assertion
 * that scans feature prose for a still-open concern needs to see both.
 */
function readFeatureListAndArchive(): string {
  const live = readFileSync(featureListPath(), "utf8");
  try {
    return live + readFileSync(featureListArchivePath(), "utf8");
  } catch {
    return live;
  }
}
