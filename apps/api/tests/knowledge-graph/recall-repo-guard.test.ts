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
const TENANT = ["claims", "claim_message_evidence", "chat_messages", "chat_threads", "ontology_objects", "ontology_edges"];

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
  it("(a) 只出现六张租户表（外加只回 id 的 kg_graph_neighbors）；不用逗号连接、不从子查询取行", () => {
    const tables = new Set([...code.matchAll(/(?<!FOR\s)(?<!DO\s)\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]+)/gi)].map((m) => m[1]!.toLowerCase()));
    for (const t of [...TENANT, "kg_graph_neighbors", "kg_turn_recalls"]) tables.delete(t);
    expect([...tables]).toEqual([]);
    expect(code).not.toMatch(/\b(?:FROM|JOIN)\s+[a-z_]+(?:\s+(?:AS\s+)?[a-z]\w*)?\s*,/i);
    expect(code).not.toMatch(/\b(?:FROM|JOIN)\s*\(/i);
  });

  it("(b) 不调用 withoutTenant", () => {
    expect(code).not.toMatch(/withoutTenant/);
  });

  it("(c) 结论与实体只有三种来源：本会话（scope_id = threadId）、发起人本人的个人空间（scope_id = userId）、发起人本人的其他个人对话（F15）；读之前设 app.current_user_id = 发起人", () => {
    expect(code).toMatch(/FROM claims c\s+WHERE c\.org_id = \$1 AND c\.scope_kind = 'chat_session' AND c\.scope_id = \$2 AND \$\{LIVE\}`,\s*\[orgId, threadId\]/);
    expect(code).toMatch(/FROM claims c\s+WHERE c\.org_id = \$1 AND c\.scope_kind = 'personal' AND c\.scope_id = \$3 AND \$\{LIVE\}[^`]*`,\s*\[orgId, threadId, userId\]/);
    expect(code).toMatch(/FROM ontology_objects\s+WHERE org_id = \$1 AND scope_kind = 'chat_session' AND scope_id = \$2 AND merged_into IS NULL`,\s*\[orgId, threadId\]/);
    expect(code).toMatch(/FROM ontology_objects\s+WHERE org_id = \$1 AND scope_kind = 'personal' AND scope_id = \$2 AND merged_into IS NULL`,\s*\[orgId, userId\]/);
    // F15（06-UX R2 M1 / E1「开新会话不用重新交代背景」，S0-2=A「个人空间 = 同一用户全部个人线程」）：
    // 第三种来源只能是**本人创建的、不挂项目的**对话里记下的——这些对话只有本人看得见（与读会话消息同一个判定），
    // 所以召回它们不会把任何别人看不到的东西交给这一轮的模型。条件逐字钉住：
    expect(code).toMatch(/SELECT \$\{CLAIM_COLUMNS\}, c\.scope_id AS thread_id, kg_claim_basis\(c\.statement\) AS basis FROM claims c\s+JOIN chat_threads t ON t\.org_id = c\.org_id AND t\.id = c\.scope_id\s+WHERE c\.org_id = \$1 AND c\.scope_kind = 'chat_session' AND c\.scope_id <> \$2 AND \$\{LIVE\}\s+AND t\.project_id IS NULL AND t\.created_by = \$3 AND NOT t\.archived/);
    expect(code).toMatch(/FROM ontology_objects o\s+JOIN chat_threads t ON t\.org_id = o\.org_id AND t\.id = o\.scope_id\s+WHERE o\.org_id = \$1 AND o\.scope_kind = 'chat_session' AND o\.scope_id <> \$2 AND o\.merged_into IS NULL\s+AND t\.project_id IS NULL AND t\.created_by = \$3 AND NOT t\.archived`,\s*\[orgId, threadId, userId\]/);
    expect(code.match(/FROM claims c\b/g)).toHaveLength(3);
    expect(code.match(/FROM ontology_objects\b/g)).toHaveLength(3);
    // 另外只允许三个去重子查询里的 `JOIN claims src` / `JOIN claims l1` / `FROM claims p`（判断「长期记忆里有没有它」，不取任何列）
    expect(code.match(/\bclaims\s+(?!c\b)\w+/g)).toEqual(["claims src", "claims l1", "claims p", "claims x", "claims x"]);
    // 改过的说了算：本会话里有同一件事、或本人哪个个人对话里把它忘掉 / 取代了 ⇒ 不从别的对话再拿（只判存在，不取列）
    expect(code).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM claims x\s+WHERE x\.org_id = c\.org_id AND x\.scope_kind = 'chat_session' AND x\.scope_id = \$2\s+AND kg_claim_basis\(x\.statement\) = kg_claim_basis\(c\.statement\)\)/);
    expect(code).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM claims x JOIN chat_threads tx ON tx\.org_id = x\.org_id AND tx\.id = x\.scope_id\s+WHERE x\.org_id = c\.org_id AND x\.scope_kind = 'chat_session' AND kg_claim_basis\(x\.statement\) = kg_claim_basis\(c\.statement\)\s+AND tx\.project_id IS NULL AND tx\.created_by = \$3 AND NOT \(x\.revoked_at IS NULL AND x\.status <> 'superseded'\)\)/);
    expect(code).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM claims p\s+WHERE p\.org_id = c\.org_id AND p\.scope_kind = 'personal' AND p\.scope_id = \$3\s+AND kg_claim_basis\(p\.statement\) = kg_claim_basis\(c\.statement\)\)/);
    expect(code.match(/\bontology_edges\b/g)).toHaveLength(2);
    expect(code).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM ontology_edges d JOIN claims src/);
    expect(code).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM ontology_edges d JOIN claims l1 ON l1\.id = d\.src_id AND l1\.org_id = d\.org_id\s+WHERE d\.org_id = c\.org_id AND d\.dst_kind = 'claim' AND d\.dst_id = c\.id AND d\.relation = 'derived_from'\s+AND l1\.scope_kind = 'personal' AND l1\.scope_id = \$3\)/);
    expect(code).toMatch(/async candidates\(orgId: OrgId, userId: string, threadId: string\) \{\s*return this\.db\.withTenant\(orgId, async \(s\) => \{\s*await s\.query\("SELECT set_config\('app\.current_user_id', \$1, true\)", \[userId\]\);/);
  });

  it("(c4) 本人其他个人对话（F15）只进发起人自己的个人线程；L1 进本人的个人线程与项目会话（issue #4284），别人的个人线程两样都不进", () => {
    // 判定 1 次 + 其他个人对话的结论 / 实体各 JOIN 一次 + 「改过的说了算」子查询 JOIN 一次
    expect(code.match(/\bchat_threads\b/g)).toHaveLength(4);
    // 判定只取两个布尔（无项目？本人创建？），不取会话的内容列
    expect(code).toMatch(/`SELECT t\.project_id IS NULL AS personal, t\.created_by = \$3 AS mine FROM chat_threads t WHERE t\.org_id = \$1 AND t\.id = \$2`,\s*\[orgId, threadId, userId\]/);
    expect(code).toMatch(/const inPersonalThread = here\?\.personal === true && here\.mine === true;/);
    expect(code).toMatch(/const withL1 = here\?\.personal === false \|\| inPersonalThread;/);
    expect(code).toMatch(/const personal = !withL1 \? \{ rows: \[\] as Row\[\] \} : await s\.query/);
    expect(code).toMatch(/const personalObjects = !withL1 \? \{ rows: \[\] as \{ id: string; name: string; aliases: string\[\] \}\[\] \} : await s\.query/);
    expect(code).toMatch(/const ownOther = !inPersonalThread \? \{ rows: \[\] as \(Row & \{ thread_id: string; basis: string \}\)\[\] \} : await s\.query/);
    expect(code).toMatch(/const ownOtherObjects = !inPersonalThread \? \{ rows: \[\] as \{ id: string; name: string; aliases: string\[\] \}\[\] \} : await s\.query/);
  });

  it("(c3) 活结论的口径钉死（F07 失效级联靠它）；chat_messages 只在「这条是哪天说的」那个证据子查询里", () => {
    expect(code).toMatch(/^const LIVE = "c\.revoked_at IS NULL AND c\.status <> 'superseded'";$/m);
    expect(code.match(/AND \$\{LIVE\}/g)).toHaveLength(3);
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

  it("(d) 调用链：kernel.module 实例化 → 执行器 → execute-run.ts turnKnowledgeContext（run）→ knowledgeMemoryFor / memoryCardFor（run.threadId / run.requesterUserId）", () => {
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
    // F17：执行器只调 turnKnowledgeContext（把 run 整个交进去），召回与开卡都在 recall-knowledge.ts 里按 run 的发起人 / 会话取参
    expect(callersOf(/(?<!function )knowledgeMemoryFor\(/)).toEqual(["src/application/knowledge-graph/recall-knowledge.ts"]);
    expect(callersOf(/(?<!function )memoryCardFor\(/)).toEqual(["src/application/knowledge-graph/recall-knowledge.ts"]);
    expect(callersOf(/(?<!function )turnKnowledgeContext\(/)).toEqual(["src/application/agent-run/execute-run.ts"]);
    const exec = readFileSync(join(API, "src/application/agent-run/execute-run.ts"), "utf8");
    expect(exec).toMatch(/turnKnowledgeContext\(deps\.knowledge, deps\.memoryCards, \{ orgId, run \}, deps\.log\)/);
    const rk = strip(readFileSync(join(API, "src/application/knowledge-graph/recall-knowledge.ts"), "utf8"));
    expect(rk).toMatch(/knowledgeMemoryFor\(knowledge, \{ orgId, userId: run\.requesterUserId, threadId: run\.threadId, query: run\.inputText, runId: run\.runId \}, log\)/);
    expect(rk).toMatch(/memoryCardFor\(knowledge, cards, \{\s*orgId, userId: run\.requesterUserId, threadId: run\.threadId, runId: run\.runId, messageId: run\.inputMessageId, text: run\.inputText,\s*\}, log\)/);
    // memoryCardFor 读候选集只拿 id 去开卡：卡上的内容由 kg_open_memory_card 在数据库里按会话 / 本人个人空间复核后才写
    expect(rk).toMatch(/const \{ claims \} = await knowledge\.candidates\(input\.orgId, input\.userId, input\.threadId\);/);
    expect(rk).toMatch(/claimIds: matches\.map\(\(c\) => c\.id\)/);
  });

  it("(g) 豁免条目的前提文字与这里钉住的一致（三种来源、chat_threads 四次、取行各三条），改代码不许只改一边", () => {
    const lint = readFileSync(join(API, "scripts/lint-permission-paths.mjs"), "utf8");
    const entry = lint.slice(lint.indexOf('"src/infrastructure/knowledge-graph/pg-knowledge-recall.ts"'));
    const text = entry.slice(0, entry.indexOf("\n  ],"));
    expect(text).toContain("召回只读三种来源");
    expect(text).toContain("`chat_threads` 恰好出现四次");
    expect(text).toContain("`claims` 与 `ontology_objects` 的取行各恰好三条");
    expect(text).toContain("tests/retrieval/kg-own-personal-threads-recall.test.ts");
    expect(code.match(/\bchat_threads\b/g)).toHaveLength(4);
    expect(code.match(/FROM claims c\b/g)).toHaveLength(3);
    expect(code.match(/FROM ontology_objects\b/g)).toHaveLength(3);
  });

  it("(e) 类成员只有端口要求的三个方法——不能悄悄多出一个读全组织的方法（不论 async / 修饰符 / 箭头属性 / getter / 缩进）", () => {
    const members = [...code.matchAll(/^\s{2}(?:(?:public|private|protected|readonly|static)\s+)*(?:async\s+)?(\w+)\s*[(=:<]/gm)]
      .map((m) => m[1]).filter((n) => n !== "constructor").sort();
    expect(members).toEqual(["candidates", "graphNeighbors", "recordTurn"]);
    expect(code).not.toMatch(/^[ \t]+(?:get|set|static)[ \t]+\w+\s*\(/m);
    expect(code).not.toMatch(/^[ \t]{3,}(?:public|private|protected|async)[ \t]+\w+\s*\(/m);
  });

  it("(e2) 模块顶层只有 stripKind、两个 SQL 片段常量和这个类——不能在类外另挂一个读正文的函数", () => {
    const topLevel = code.split("\n").filter((l) => /^\S/.test(l) && !/^(?:import\b|\}|\)|export\s+type\b|type\b)/.test(l));
    expect(topLevel.map((l) => /^(?:export\s+)?(?:const|class)\s+(\w+)/.exec(l)?.[1] ?? l)).toEqual(["stripKind", "LIVE", "CLAIM_COLUMNS", "PgKnowledgeRecall"]);
  });

  it("(f) kg_turn_recalls 只写不读：一条 INSERT … ON CONFLICT (run_id)，写的是调用方给的这一个 run", () => {
    expect(code.match(/kg_turn_recalls/g)).toHaveLength(1);
    expect(code).toMatch(/INSERT INTO kg_turn_recalls \(run_id, org_id, thread_id, requester_user_id, items, graph_degraded\)/);
    expect(code).not.toMatch(/FROM kg_turn_recalls|JOIN kg_turn_recalls|UPDATE kg_turn_recalls/);
  });
});
