/**
 * F48 · O-22③ -- a composite (`whisper ＋ sonnet`) is ONE row in the pool with ONE
 * `model_id`, not two fields stitched together on the agent (invariants I-3, I-4, I-5).
 *
 * ## Why "one record" is asserted on the CONTRACT and not only on a helper
 *
 * The failure this rules out is not a wrong return value, it is a second shape: an
 * `agent.models: string[]`, or a `registerCompositeModel` beside `registerModel`. Neither
 * would break any unit test of `effectiveKind`. So the first half of this file walks all 57
 * operations and asserts that every model reference in the bundle is a scalar and that the
 * only way to create a composite is the ordinary registration.
 *
 * The second half asserts the two rules that make one record behave like one thing:
 * `effectiveKind` (I-4) and `compositeBlock` (I-5). Both carry a counter-proof, because both
 * are the kind of function whose wrong version passes the happy path -- union instead of
 * intersection returns MORE attributes, and "any member disabled" written as "all members
 * disabled" returns null on exactly the input that matters.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { agentRuntime as C } from "@repo/contracts";
import {
  compositeBlock,
  effectiveComplianceAttrs,
  effectiveKind,
  survivesLocalOnly,
  type CompositeMemberState,
} from "../../../src/domain/model/composite";
import { schemaKeyNames } from "../../../src/domain/model/registry";

/** `whisper（自托管 · 转录）→ sonnet（闭源 · 生成）`, the prototype's own example. */
const whisper: CompositeMemberState = {
  modelId: "m-whisper",
  role: "转录",
  kind: "self-hosted",
  status: "已启用",
  complianceAttrs: ["attr-a", "attr-b"],
};
const sonnet: CompositeMemberState = {
  modelId: "m-sonnet",
  role: "生成",
  kind: "closed-api",
  status: "已启用",
  complianceAttrs: ["attr-b", "attr-c"],
};

describe("one record, one model_id (O-22③ / I-3)", () => {
  it("registerModel takes the members and returns a SINGLE modelId", () => {
    expect(Object.keys(C.operations.registerModel.in.shape)).toContain("members");
    const out = C.operations.registerModel.out;
    expect([...schemaKeyNames(out)].sort()).toEqual(["modelId", "status"]);
    // Scalar, not an array: the parse of a one-element array must fail.
    expect(out.safeParse({ modelId: ["m-1"], status: "待测试" }).success).toBe(false);
    expect(out.safeParse({ modelId: "m-1", status: "待测试" }).success).toBe(true);
  });

  it("there is no second creation path for composites", () => {
    const ops = Object.keys(C.operations);
    expect(ops.filter((o) => /composite/i.test(o))).toEqual([]);
    // A composite is registered by the same operation as a single model, distinguished by
    // `shape`. Two operations would be two definitions of what a composite is.
    expect(C.ModelShape.options).toContain("composite");
    expect(ops.length, "read no operations -- these assertions would be vacuous").toBeGreaterThan(40);
  });

  it("every model reference in the bundle is a scalar (I-3)", () => {
    const offenders: string[] = [];
    for (const [name, op] of Object.entries(C.operations) as readonly [string, { in?: unknown }][]) {
      if (!op.in) continue;
      for (const path of arrayOfModelIdPaths(op.in as z.ZodTypeAny, name)) offenders.push(path);
    }
    // `members[].modelId` is the composite pipeline itself, and `candidateModelIds` is a
    // routing decision's candidate set -- neither is a consumer picking a model. Anything
    // else being an array would mean an agent or a skill can hold two.
    expect(offenders).toEqual([]);
  });

  it("counter-proof: the scalar walk CATCHES an agent that holds two models", () => {
    const leaky = z.object({ agentId: z.string(), modelIds: z.array(z.string()) });
    expect(arrayOfModelIdPaths(leaky, "updateAgentDefinitionLeaky")).toEqual([
      "updateAgentDefinitionLeaky.modelIds[]",
    ]);
  });
});

describe("I-4: the chain's kind is the strictest of its members", () => {
  it("whisper(self-hosted) ＋ sonnet(closed-api) is a CLOSED-API chain", () => {
    expect(effectiveKind([whisper, sonnet])).toBe("closed-api");
    expect(survivesLocalOnly([whisper, sonnet])).toBe(false);
  });

  it("counter-proof: `all members closed` would call the same chain self-hosted", () => {
    // The wrong rule, written out, run on the same input. It returns the answer that lets
    // confidential material leave the building -- which is why "any", not "all".
    const wrong = (ms: readonly CompositeMemberState[]) =>
      ms.every((m) => m.kind === "closed-api") ? "closed-api" : "self-hosted";
    expect(wrong([whisper, sonnet])).toBe("self-hosted");
    expect(effectiveKind([whisper, sonnet])).not.toBe(wrong([whisper, sonnet]));
  });

  it("an all-self-hosted chain stays self-hosted, so the rule is not just 'always closed'", () => {
    const local = { ...sonnet, modelId: "m-qwen", kind: "self-hosted" } as const;
    expect(effectiveKind([whisper, local])).toBe("self-hosted");
    expect(survivesLocalOnly([whisper, local])).toBe(true);
  });

  it("an empty member list is closed-api: unknown provenance is not evidence of local", () => {
    expect(effectiveKind([])).toBe("closed-api");
    expect(survivesLocalOnly([])).toBe(false);
  });
});

describe("I-4: compliance attributes are the INTERSECTION, never the union", () => {
  it("only the attribute both members carry survives", () => {
    expect(effectiveComplianceAttrs([whisper, sonnet])).toEqual(["attr-b"]);
  });

  it("counter-proof: the union would promise `attr-a`, which sonnet does not honour", () => {
    const union = [...new Set([...whisper.complianceAttrs, ...sonnet.complianceAttrs])];
    expect(union).toContain("attr-a");
    expect(effectiveComplianceAttrs([whisper, sonnet])).not.toContain("attr-a");
    expect(effectiveComplianceAttrs([whisper, sonnet]).length).toBeLessThan(union.length);
  });

  it("a member with no attributes collapses the chain to none", () => {
    expect(effectiveComplianceAttrs([whisper, { ...sonnet, complianceAttrs: [] }])).toEqual([]);
  });

  it("an empty chain promises nothing (not everything)", () => {
    expect(effectiveComplianceAttrs([])).toEqual([]);
  });
});

describe("I-5: a disabled member takes the whole chain down, with no silent fallback", () => {
  it("an enabled chain is not blocked", () => {
    expect(compositeBlock([whisper, sonnet])).toBeNull();
  });

  it("disabling whisper blocks the chain and names the member", () => {
    const block = compositeBlock([{ ...whisper, status: "已停用" }, sonnet]);
    expect(block?.reason).toBe("COMPOSITE_MEMBER_DISABLED");
    expect(block?.memberIds).toEqual(["m-whisper"]);
    // The contract agrees this is the code, so the domain and the API cannot drift on it.
    expect(C.operations.enableModel.err).toContain("COMPOSITE_MEMBER_DISABLED");
    expect(C.operations.routeModelCall.err).toContain("COMPOSITE_MEMBER_DISABLED");
  });

  it("`依赖失败` blocks too -- I-5 is 'not 已启用', not 'explicitly disabled'", () => {
    expect(compositeBlock([{ ...whisper, status: "依赖失败" }, sonnet])?.memberIds).toEqual([
      "m-whisper",
    ]);
    expect(compositeBlock([{ ...whisper, status: "待测试" }, sonnet])?.memberIds).toEqual([
      "m-whisper",
    ]);
  });

  it("counter-proof: 'all members disabled' returns null on exactly the dangerous input", () => {
    const members = [{ ...whisper, status: "已停用" as const }, sonnet];
    const wrong = members.every((m) => m.status !== "已启用") ? "blocked" : null;
    expect(wrong).toBeNull(); // the wrong rule lets a half-broken chain run
    expect(compositeBlock(members)).not.toBeNull();
  });

  it("there is no degrade-to-single-model path: the block names ALL broken members", () => {
    const block = compositeBlock([
      { ...whisper, status: "已停用" },
      { ...sonnet, status: "已停用" },
    ]);
    expect(block?.memberIds).toEqual(["m-whisper", "m-sonnet"]);
    // The domain returns a block, never a surviving subset. A "fall back to the member that
    // still works" would have to return members, and nothing here can.
    expect(Object.keys(block!).sort()).toEqual(["memberIds", "reason"]);
  });
});

/** Paths where a key named like a model reference is an ARRAY. */
function arrayOfModelIdPaths(schema: z.ZodTypeAny, path: string, seen = new Set<unknown>()): string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);
  const def = (schema as unknown as { _def?: Record<string, unknown> })._def;
  const kind = def?.typeName as string | undefined;
  const hits: string[] = [];
  if (kind === "ZodObject") {
    const shape = (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
    for (const [key, value] of Object.entries(shape)) {
      const inner = unwrap(value);
      const isArray = (inner as unknown as { _def?: { typeName?: string } })._def?.typeName === "ZodArray";
      // `candidateModelIds` and `members` are the two legitimate plural shapes; see the test.
      const exempt = key === "candidateModelIds" || key === "members";
      if (isArray && /modelId/i.test(key) && !exempt) hits.push(`${path}.${key}[]`);
      hits.push(...arrayOfModelIdPaths(value, `${path}.${key}`, seen));
    }
    return hits;
  }
  if (kind === "ZodArray") return arrayOfModelIdPaths(def!.type as z.ZodTypeAny, `${path}[]`, seen);
  if (kind === "ZodOptional" || kind === "ZodNullable") {
    return arrayOfModelIdPaths(def!.innerType as z.ZodTypeAny, path, seen);
  }
  if (kind === "ZodUnion") {
    return (def!.options as readonly z.ZodTypeAny[]).flatMap((o) => arrayOfModelIdPaths(o, path, seen));
  }
  return hits;
}

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = (schema as unknown as { _def?: Record<string, unknown> })._def;
  const kind = def?.typeName as string | undefined;
  return kind === "ZodOptional" || kind === "ZodNullable"
    ? unwrap(def!.innerType as z.ZodTypeAny)
    : schema;
}
