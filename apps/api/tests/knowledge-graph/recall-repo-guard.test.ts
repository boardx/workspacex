/**
 * Phase 18 F08 —— `pg-knowledge-recall.ts` 权限豁免（scripts/lint-permission-paths.mjs 的 ALLOWLIST）
 * 成立的前提，逐条钉住。前提任何一条变了，这里红，豁免就要重新论证。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API = fileURLToPath(new URL("../..", import.meta.url));
const code = readFileSync(join(API, "src/infrastructure/knowledge-graph/pg-knowledge-recall.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const callersOf = (re: RegExp) => walk(join(API, "src"))
  .filter((f) => re.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")))
  .map((f) => relative(API, f)).sort();

describe("F08 会话记忆召回读取的豁免前提", () => {
  it("(a) 只出现五张租户表（外加只回 id 的 kg_graph_neighbors）", () => {
    const tables = new Set([...code.matchAll(/(?<!FOR\s)\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]+)/gi)].map((m) => m[1]!.toLowerCase()));
    for (const t of ["claims", "claim_message_evidence", "chat_messages", "ontology_objects", "ontology_edges", "kg_graph_neighbors"]) tables.delete(t);
    expect([...tables]).toEqual([]);
  });

  it("(b) 不调用 withoutTenant", () => {
    expect(code).not.toMatch(/withoutTenant/);
  });

  it("(c) 结论与实体只有两种来源：本会话（scope_id = threadId）或发起人本人的个人空间（scope_id = userId）", () => {
    expect(code).toMatch(/FROM claims c\s+WHERE c\.org_id = \$1 AND c\.scope_kind = 'chat_session' AND c\.scope_id = \$2 AND \$\{LIVE\}`,\s*\[orgId, threadId\]/);
    expect(code).toMatch(/FROM claims c\s+WHERE c\.org_id = \$1 AND c\.scope_kind = 'personal' AND c\.scope_id = \$3 AND[\s\S]*?`,\s*\[orgId, threadId, userId\]/);
    expect(code).toMatch(/FROM ontology_objects\s+WHERE org_id = \$1 AND scope_kind = 'chat_session' AND scope_id = \$2 AND merged_into IS NULL`,\s*\[orgId, threadId\]/);
    expect(code).toMatch(/FROM ontology_objects\s+WHERE org_id = \$1 AND scope_kind = 'personal' AND scope_id = \$2 AND merged_into IS NULL`,\s*\[orgId, userId\]/);
    // 上面四条就是全部的顶层读取；另外只允许去重子查询里的 `JOIN claims src`
    expect(code.match(/FROM claims c\b/g)).toHaveLength(2);
    expect(code.match(/FROM ontology_objects\b/g)).toHaveLength(2);
    expect(code.match(/\bclaims\s+(?!c\b)\w+/g)).toEqual(["claims src"]);
    // 作用域条件不能被 OR / UNION 放宽
    expect(code).not.toMatch(/\b(?:OR|UNION)\b/);
  });

  it("(d) 调用链：candidates/graphNeighbors ← recall-knowledge.ts（knowledgeMemoryFor）← execute-run.ts（run.threadId / run.requesterUserId）", () => {
    expect(callersOf(/\.(candidates|graphNeighbors)\(/)).toEqual(["src/application/knowledge-graph/recall-knowledge.ts"]);
    // recallThreadKnowledge 只在 recall-knowledge.ts 内部被 knowledgeMemoryFor 调用；后者的唯一调用方是 execute-run.ts
    expect(callersOf(/(?<!function )recallThreadKnowledge\(/)).toEqual(["src/application/knowledge-graph/recall-knowledge.ts"]);
    expect(callersOf(/(?<!function )knowledgeMemoryFor\(/)).toEqual(["src/application/agent-run/execute-run.ts"]);
    const exec = readFileSync(join(API, "src/application/agent-run/execute-run.ts"), "utf8");
    expect(exec).toMatch(/knowledgeMemoryFor\(deps\.knowledge, \{ orgId, userId: run\.requesterUserId, threadId: run\.threadId, query: run\.inputText, runId: run\.runId \}/);
  });
});
