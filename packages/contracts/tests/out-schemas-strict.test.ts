import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as identity from "../src/identity";
import * as artifact from "../src/artifact";
import * as contextPack from "../src/context-pack";
import * as auth from "../src/auth";
import * as project from "../src/project";
import * as interview from "../src/interview";
import * as recording from "../src/recording";
import * as canvas from "../src/canvas";
import * as chat from "../src/chat";
import * as files from "../src/files";
import * as orgAdmin from "../src/org-admin";
import * as assetGovernance from "../src/asset-governance";
import * as agentRuntime from "../src/agent-runtime";
import * as skills from "../src/skills";
import * as templates from "../src/templates";
import * as research from "../src/research";

/**
 * Every operation's `out` must be STRICT.
 *
 * ## The hole this closes
 *
 * `contract-design.md` hard rule 6 says responses are validated against the contract, and
 * every bundle does `C.operations.<op>.out.safeParse(body)`. That assertion is **half
 * blind**: a zod object STRIPS unknown keys, so a response carrying an extra field parses
 * clean. F19 proved it by injecting `orgName` into a response -- `safeParse` stayed green.
 *
 * And extra fields are the COMMON direction of response drift, precisely because nothing
 * breaks when it happens: someone adds a field for a new screen, the old clients ignore it,
 * the contract never learns about it, and six months later two teams disagree about what
 * the endpoint returns.
 *
 * `.strict()` makes the parse fail on an unknown key, which is what rule 6 always meant.
 *
 * ⚠ `.strict()` does NOT propagate into nested objects or array elements -- each level
 * declares it separately. This test walks the tree so a nested object cannot be forgotten.
 */

const BUNDLES = {
  identity, artifact, contextPack, auth, project,
  // ── phase-01 十一束（不加进来 = 这道门对新契约完全不生效）──
  interview, recording, canvas, chat, files, orgAdmin, assetGovernance,
  agentRuntime, skills, templates, research,
} as const;

/** Every ZodObject reachable from a schema, with a path for the failure message. */
function objectsIn(schema: z.ZodTypeAny, path: string, out: [string, z.ZodObject<z.ZodRawShape>][] = [], seen = new Set<unknown>()): [string, z.ZodObject<z.ZodRawShape>][] {
  if (seen.has(schema)) return out;
  seen.add(schema);
  const def = (schema as { _def?: { typeName?: string; type?: z.ZodTypeAny; innerType?: z.ZodTypeAny; options?: z.ZodTypeAny[] } })._def;
  if (schema instanceof z.ZodObject) {
    out.push([path, schema as z.ZodObject<z.ZodRawShape>]);
    for (const [k, v] of Object.entries(schema.shape)) objectsIn(v as z.ZodTypeAny, `${path}.${k}`, out, seen);
    return out;
  }
  if (def?.type) objectsIn(def.type, `${path}[]`, out, seen);
  if (def?.innerType) objectsIn(def.innerType, path, out, seen);
  for (const o of def?.options ?? []) objectsIn(o, path, out, seen);
  return out;
}

describe("每个操作的 out schema 必须是 strict 的", () => {
  const loose: string[] = [];
  for (const [bundle, mod] of Object.entries(BUNDLES)) {
    const ops = (mod as { operations?: Record<string, { out?: z.ZodTypeAny }> }).operations;
    if (!ops) continue;
    for (const [opName, op] of Object.entries(ops)) {
      if (!op.out) continue;
      for (const [path, obj] of objectsIn(op.out, `${bundle}.${opName}.out`)) {
        if (obj._def.unknownKeys !== "strict") loose.push(path);
      }
    }
  }

  it("没有一个 out（含嵌套与数组元素）是宽松的", () => {
    expect(
      loose,
      `这些 out schema 会**静默吞掉**多出来的字段，于是 hard rule 6 的断言只挡住一半：\n  ${loose.join("\n  ")}\n` +
        `修法：给每一层 z.object({...}) 加 .strict()。`,
    ).toEqual([]);
  });

  it("这条断言不是空转的：它确实认得出宽松与严格", () => {
    // 没有这一条，上面那条在「一个 out 都没扫到」时也会绿。
    const lax = z.object({ a: z.string() });
    const strict = z.object({ a: z.string() }).strict();
    expect(lax._def.unknownKeys).not.toBe("strict");
    expect(strict._def.unknownKeys).toBe("strict");
    expect(lax.safeParse({ a: "x", extra: 1 }).success, "宽松的确实吞掉了多余字段").toBe(true);
    expect(strict.safeParse({ a: "x", extra: 1 }).success, "严格的确实拒绝了").toBe(false);
    // 且真的扫到了东西
    const total = Object.entries(BUNDLES).flatMap(([b, m]) =>
      Object.entries((m as { operations?: Record<string, { out?: z.ZodTypeAny }> }).operations ?? {}).flatMap(([o, op]) =>
        op.out ? objectsIn(op.out, `${b}.${o}`) : [],
      ),
    );
    expect(total.length, "一个 out 都没扫到，上面那条会永远为真").toBeGreaterThan(20);
  });
});
