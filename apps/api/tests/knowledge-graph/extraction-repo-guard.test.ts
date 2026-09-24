/**
 * Phase 18 F06 —— `pg-kg-extraction.ts` 权限豁免（scripts/lint-permission-paths.mjs 的 ALLOWLIST）
 * 成立的前提，逐条钉住。前提任何一条变了，这里红，豁免就要重新论证。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API = fileURLToPath(new URL("../..", import.meta.url));
const REPO = "src/infrastructure/knowledge-graph/pg-kg-extraction.ts";
const src = readFileSync(join(API, REPO), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("F06 抽取流水线读取的豁免前提", () => {
  it("(a) 只出现三张租户表", () => {
    const tables = new Set([...code.matchAll(/(?<!FOR\s)\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]+)/gi)].map((m) => m[1]!.toLowerCase()));
    tables.delete("kg_extraction_queue");
    tables.delete("chat_messages");
    tables.delete("ontology_objects");
    expect([...tables]).toEqual([]);
  });

  it("(b) withoutTenant 只用于 kg_extraction_pending_orgs()", () => {
    const uses = [...code.matchAll(/withoutTenant\(([\s\S]*?)\)\);/g)].map((m) => m[1]!);
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatch(/kg_extraction_pending_orgs\(\)/);
  });

  it("(c) 上文限定同一会话；已知实体限定本会话作用域", () => {
    expect(code).toMatch(/FROM chat_messages\s+WHERE org_id = \$1 AND thread_id = \$2/);
    expect(code).toMatch(/scope_kind = 'chat_session' AND scope_id = \$2/);
  });

  it("(d) loadMessage / knownObjects 的唯一调用方是抽取用例", () => {
    const callers = walk(join(API, "src"))
      .filter((f) => /\.(loadMessage|knownObjects)\(/.test(readFileSync(f, "utf8")))
      .map((f) => relative(API, f));
    expect(callers).toEqual(["src/application/knowledge-graph/extract-message-knowledge.ts"]);
  });
});
