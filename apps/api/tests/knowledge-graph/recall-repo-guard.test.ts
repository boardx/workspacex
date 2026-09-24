/**
 * Phase 18 F08 —— `pg-knowledge-recall.ts` 权限豁免（scripts/lint-permission-paths.mjs 的 ALLOWLIST）
 * 成立的前提，逐条钉住。前提任何一条变了，这里红，豁免就要重新论证。
 * 与 F06 的 extraction-repo-guard 同一道门槛：整个文件都在豁免里，所以不只看已有的查询，
 * 还要保证文件里不会悄悄多出别的读路径（新方法、类外函数、OR / UNION 放宽、逗号连接、子查询）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API = fileURLToPath(new URL("../..", import.meta.url));
const REPO = "src/infrastructure/knowledge-graph/pg-knowledge-recall.ts";
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const code = strip(readFileSync(join(API, REPO), "utf8"));
/** 源码里的全部字符串字面量（反引号 / 双引号 / 单引号）。 */
const strings = [...code.matchAll(/`([^`]*)`|"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
const sqls = strings.filter((q) => /\b(?:SELECT|FROM|JOIN)\b/i.test(q));
const TENANT = ["claims", "claim_message_evidence", "chat_messages", "ontology_objects", "ontology_edges"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const callersOf = (re: RegExp) => walk(join(API, "src"))
  .filter((f) => !f.endsWith("pg-knowledge-recall.ts") && re.test(strip(readFileSync(f, "utf8"))))
  .map((f) => relative(API, f)).sort();

describe("F08 会话记忆召回读取的豁免前提", () => {
  it("(a) 只出现五张租户表（外加只回 id 的 kg_graph_neighbors）；不用逗号连接、不从子查询取行", () => {
    const tables = new Set([...code.matchAll(/(?<!FOR\s)\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]+)/gi)].map((m) => m[1]!.toLowerCase()));
    for (const t of [...TENANT, "kg_graph_neighbors"]) tables.delete(t);
    expect([...tables]).toEqual([]);
    expect(code).not.toMatch(/\b(?:FROM|JOIN)\s+[a-z_]+(?:\s+(?:AS\s+)?[a-z]\w*)?\s*,/i);
    expect(code).not.toMatch(/\b(?:FROM|JOIN)\s*\(/i);
  });

  it("(b) 不调用 withoutTenant", () => {
    expect(code).not.toMatch(/withoutTenant/);
  });

  it("(c) 结论与实体只有两种来源：本会话（scope_id = threadId）或发起人本人的个人空间（scope_id = userId）；读之前设 app.current_user_id = 发起人", () => {
    expect(code).toMatch(/FROM claims c\s+WHERE c\.org_id = \$1 AND c\.scope_kind = 'chat_session' AND c\.scope_id = \$2 AND \$\{LIVE\}`,\s*\[orgId, threadId\]/);
    expect(code).toMatch(/FROM claims c\s+WHERE c\.org_id = \$1 AND c\.scope_kind = 'personal' AND c\.scope_id = \$3 AND \$\{LIVE\}[^`]*`,\s*\[orgId, threadId, userId\]/);
    expect(code).toMatch(/FROM ontology_objects\s+WHERE org_id = \$1 AND scope_kind = 'chat_session' AND scope_id = \$2 AND merged_into IS NULL`,\s*\[orgId, threadId\]/);
    expect(code).toMatch(/FROM ontology_objects\s+WHERE org_id = \$1 AND scope_kind = 'personal' AND scope_id = \$2 AND merged_into IS NULL`,\s*\[orgId, userId\]/);
    expect(code.match(/FROM claims c\b/g)).toHaveLength(2);
    expect(code.match(/FROM ontology_objects\b/g)).toHaveLength(2);
    // 另外只允许 L1 去重子查询里的 `JOIN claims src`（判断「是否从本会话晋升出去」，不取任何列）
    expect(code.match(/\bclaims\s+(?!c\b)\w+/g)).toEqual(["claims src"]);
    expect(code.match(/\bontology_edges\b/g)).toHaveLength(1);
    expect(code).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM ontology_edges d JOIN claims src/);
    expect(code).toMatch(/async candidates\(orgId: OrgId, userId: string, threadId: string\) \{\s*return this\.db\.withTenant\(orgId, async \(s\) => \{\s*await s\.query\("SELECT set_config\('app\.current_user_id', \$1, true\)", \[userId\]\);/);
  });

  it("(c3) 活结论的口径钉死（F07 失效级联靠它）；chat_messages 只在「这条是哪天说的」那个证据子查询里", () => {
    expect(code).toMatch(/^const LIVE = "c\.revoked_at IS NULL AND c\.status <> 'superseded'";$/m);
    expect(code.match(/AND \$\{LIVE\}/g)).toHaveLength(2);
    expect(code.match(/\bchat_messages\b/g)).toHaveLength(1);
    expect(code).toMatch(/\(SELECT min\(m\.created_at\) FROM claim_message_evidence e JOIN chat_messages m ON m\.id = e\.message_id AND m\.org_id = e\.org_id\s+WHERE e\.claim_id = c\.id AND e\.stance = 'supporting'\) AS said_at/);
  });

  it("(c2) 任何 SQL 都不带 OR / UNION（作用域条件不能被放宽）；租户表名只出现在这些 SQL 字符串里", () => {
    expect(sqls.length).toBeGreaterThan(0);
    for (const q of sqls) expect(q, q).not.toMatch(/\b(?:OR|UNION)\b/i);
    for (const t of TENANT) {
      // `claims` 也是普通标识符（claims.rows），只数 SQL 位置上的出现；其余三张表名是 snake_case，全文都数
      const re = t === "claims" ? /\b(?:FROM|JOIN|INTO|UPDATE)\s+claims\b/gi : new RegExp(`\\b${t}\\b`, "g");
      const inCode = code.match(re)?.length ?? 0;
      const inSql = sqls.reduce((n, q) => n + (q.match(re)?.length ?? 0), 0);
      expect(inCode, t).toBe(inSql);
    }
  });

  it("(d) 调用链：kernel.module 实例化 → 执行器 → knowledgeMemoryFor（recall-knowledge.ts）← execute-run.ts（run.threadId / run.requesterUserId）", () => {
    // 拿到这个端口实例的路只有一条：kernel.module 实例化后交给执行器；端口类型 / 注入令牌不许出现在别处
    //（方法名 candidates 太常见，按名字找调用方挡不住 `port.candidates.call(...)` 这类写法，所以钉「谁拿得到端口」）。
    expect(callersOf(/\bPgKnowledgeRecall\b/)).toEqual(["src/kernel.module.ts"]);
    expect(callersOf(/\bKnowledgeRecallPort\b/)).toEqual([
      "src/application/agent-run/execute-run.ts", "src/application/knowledge-graph/ports.ts",
      "src/application/knowledge-graph/recall-knowledge.ts", "src/infrastructure/agent-run/agent-run-executor.ts",
    ]);
    expect(callersOf(/\bKNOWLEDGE_RECALL_PORT\b/)).toEqual(["src/application/knowledge-graph/ports.ts"]);
    expect(callersOf(/\.graphNeighbors\b/)).toEqual(["src/application/knowledge-graph/recall-knowledge.ts"]);
    expect(callersOf(/(?<!function )recallThreadKnowledge\(/)).toEqual(["src/application/knowledge-graph/recall-knowledge.ts"]);
    expect(callersOf(/(?<!function )knowledgeMemoryFor\(/)).toEqual(["src/application/agent-run/execute-run.ts"]);
    const exec = readFileSync(join(API, "src/application/agent-run/execute-run.ts"), "utf8");
    expect(exec).toMatch(/knowledgeMemoryFor\(deps\.knowledge, \{ orgId, userId: run\.requesterUserId, threadId: run\.threadId, query: run\.inputText, runId: run\.runId \}/);
  });

  it("(e) 类成员只有端口要求的两个方法——不能悄悄多出一个读全组织的方法（不论 async / 修饰符 / 箭头属性 / getter / 缩进）", () => {
    const members = [...code.matchAll(/^\s{2}(?:(?:public|private|protected|readonly|static)\s+)*(?:async\s+)?(\w+)\s*[(=:<]/gm)]
      .map((m) => m[1]).filter((n) => n !== "constructor").sort();
    expect(members).toEqual(["candidates", "graphNeighbors"]);
    expect(code).not.toMatch(/^[ \t]+(?:get|set|static)[ \t]+\w+\s*\(/m);
    expect(code).not.toMatch(/^[ \t]{3,}(?:public|private|protected|async)[ \t]+\w+\s*\(/m);
  });

  it("(e2) 模块顶层只有 stripKind、两个 SQL 片段常量和这个类——不能在类外另挂一个读正文的函数", () => {
    const topLevel = code.split("\n").filter((l) => /^\S/.test(l) && !/^(?:import\b|\}|\)|export\s+type\b|type\b)/.test(l));
    expect(topLevel.map((l) => /^(?:export\s+)?(?:const|class)\s+(\w+)/.exec(l)?.[1] ?? l)).toEqual(["stripKind", "LIVE", "CLAIM_COLUMNS", "PgKnowledgeRecall"]);
  });
});
