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
  it("(a) 只出现三张租户表；不用逗号连接（逗号连接会让下面的逐表扫描漏掉第二张表）", () => {
    expect(code).not.toMatch(/\b(?:FROM|JOIN)\s+[a-z_]+(?:\s+(?:AS\s+)?[a-z]\w*)?\s*,/i);
    const tables = new Set([...code.matchAll(/(?<!FOR\s)\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]+)/gi)].map((m) => m[1]!.toLowerCase()));
    tables.delete("kg_extraction_queue");
    tables.delete("chat_messages");
    tables.delete("ontology_objects");
    tables.delete("picked");  // 认领用的物化 CTE，不是表
    expect([...tables]).toEqual([]);
  });

  it("(b) withoutTenant 只用于两个只回 id / 开关的函数：kg_extraction_pending_orgs()、kg_extraction_enable()", () => {
    const uses = [...code.matchAll(/withoutTenant\(([\s\S]*?)\)\);/g)].map((m) => m[1]!);
    expect(uses).toHaveLength(2);
    expect(uses.some((u) => /kg_extraction_pending_orgs\(\)/.test(u))).toBe(true);
    expect(uses.some((u) => /kg_extraction_enable\(\)/.test(u))).toBe(true);
    for (const u of uses) expect(u).not.toMatch(/\b(?:FROM|JOIN)\s+(?!kg_extraction)/i);
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

  it("(e) 类成员只有端口要求的方法——不能悄悄多出一个「读全部正文」的方法（不论 async / 修饰符 / 箭头属性）", () => {
    const members = [...code.matchAll(/^\s{2}(?:(?:public|private|protected|readonly|static)\s+)*(?:async\s+)?(\w+)\s*[(=:<]/gm)]
      .map((m) => m[1]).filter((n) => n !== "constructor").sort();
    expect(members).toEqual(["claim", "complete", "enable", "fail", "knownObjects", "loadMessage", "pendingOrgs"]);
  });

  it("(e2) 模块顶层只有三个常量和这个类——不能在类外另挂一个读正文的函数 / 箭头常量（整个文件都在豁免里）", () => {
    const topLevel = code.split("\n").filter((l) => /^\S/.test(l) && !/^(?:import\b|\}|\)|export\s+type\b|type\b)/.test(l) && !/^\s*$/.test(l));
    expect(topLevel.map((l) => /^(?:export\s+)?(?:const|class)\s+(\w+)/.exec(l)?.[1] ?? l)).toEqual([
      "KG_EXTRACTION_MAX_ATTEMPTS", "KG_EXTRACTION_LEASE_SECONDS", "KG_EXTRACTION_BACKOFF_SECONDS", "PgKgExtraction",
    ]);
    // 类只在组装处实例化：别的生产代码只能取常量
    const users = walk(join(API, "src"))
      .filter((f) => /\bPgKgExtraction\b/.test(readFileSync(f, "utf8")) && !f.endsWith("pg-kg-extraction.ts"))
      .map((f) => relative(API, f));
    expect(users).toEqual(["src/kernel.module.ts"]);
  });

  it("(f) 每一条碰 chat_messages 的 SQL 都限定到一条消息（id = $2）或一个会话（thread_id = $2）", () => {
    const sqls = [...code.matchAll(/`([^`]*)`|"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "").filter((q) => /chat_messages/i.test(q));
    expect(sqls.length).toBeGreaterThan(0);
    for (const q of sqls) {
      expect(q, q).toMatch(/\b(?:id|thread_id) = \$2\b/);
      // 限定条件要真的起作用：OR / UNION 都能把它绕开
      expect(q, q).not.toMatch(/\b(?:OR|UNION)\b/i);
    }
    // 源码里任何位置出现这张表名，都必须落在上面扫描过的字符串里（拼接 / 模板插值都不行）
    expect(code.match(/chat_messages/gi)?.length).toBe(sqls.reduce((n, q) => n + (q.match(/chat_messages/gi)?.length ?? 0), 0));
  });

  it("(g) 已知实体的读取不带 OR / UNION（作用域条件不能被放宽）", () => {
    const q = /FROM ontology_objects[\s\S]*?ORDER BY/.exec(code)?.[0] ?? "";
    expect(q).toMatch(/scope_kind = 'chat_session' AND scope_id = \$2/);
    expect(q).not.toMatch(/\b(?:OR|UNION)\b/i);
  });
});

