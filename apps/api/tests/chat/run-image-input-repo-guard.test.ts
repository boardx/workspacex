/**
 * P2（#1561）—— 把 `pg-run-image-input.ts` 那条 `lint-permission-paths` 豁免的**前提**钉成
 * 机械事实（同 `tool-trace-context-repo-guard.test.ts` / `agent-run-context-snapshot-repo-guard.test.ts`
 * 的形状）。
 *
 * 豁免的理由有三半，三半都在这里被断言：
 *
 *   (a) 仓储只名到 `chat_message_attachments`/`chat_messages` 两张表，且从不 `withoutTenant`。
 *   (b) 两条 SQL 的 scope 谓词**都**同时带着 `message_id` 与 `m.author_id` 两条锚——少任何
 *       一条，这条读路径就从「run 自己那条消息的附件」扩大成一个新的可见面。
 *   (c) `src/interface/` 下没有任何 controller 直接触达它——它是组装用的内部素材，
 *       不是面向请求者的披露面。
 *
 * 这个文件被删掉时，allowlist 里那一行必须跟着删。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(__dirname, "../../src/infrastructure/agent-run/pg-run-image-input.ts");
const INTERFACE_DIR = join(__dirname, "../../src/interface");

/** 先剥注释再扫——头注逐字提到表名，直接对全文匹配会被自己的说明文字触发。 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTsFiles(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("P2 pg-run-image-input 仓储的权限豁免前提", () => {
  const repoSource = code(readFileSync(REPO, "utf8"));

  it("(a) 仓储只名到 chat_message_attachments / chat_messages 两张表", () => {
    const named = [...repoSource.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_][a-z0-9_]*)/gi)]
      .map((m) => m[1]!.toLowerCase())
      .filter((name) => name !== "set");
    expect(named.length).toBeGreaterThan(0); // 反空转：匹配器必须真的匹配到东西。
    expect([...new Set(named)].sort()).toEqual(["chat_message_attachments", "chat_messages"]);
  });

  it("(a) 之二：没有 withoutTenant——那条路会关掉 RLS", () => {
    expect(repoSource).not.toContain("withoutTenant");
    expect(repoSource).toContain("withTenant");
  });

  it("(b) 两条 SQL 各自都带 message_id 与 author_id 两条锚（范围锚在本轮触发消息）", () => {
    const statements = [...repoSource.matchAll(/`\s*\n?SELECT[\s\S]*?`/g)].map((m) => m[0]);
    // 两条 SQL：LIST_SQL 与 READ_REF_SQL。少一条说明有人删了独立判权、改成信任调用顺序。
    expect(statements).toHaveLength(2);
    for (const sql of statements) {
      expect(sql).toContain("a.org_id = $1");
      expect(sql).toContain("a.thread_id = $2");
      expect(sql).toContain("a.message_id = $3");
      // 这一条是关键：把「run 的请求者」与「消息作者」的一致性变成查询条件本身，
      // 而不是靠一条注释提醒后来的人别忘了判权。
      expect(sql).toContain("m.author_id = $4");
    }
  });

  it("(b) 之二：list 的 SQL 没有 LIMIT——加了就变成静默截断（#1561 明文禁止）", () => {
    expect(repoSource).not.toMatch(/\bLIMIT\b/i);
  });

  it("(c) src/interface/ 下没有任何 controller 直接触达这个仓储或它的端口", () => {
    const files = walkTsFiles(INTERFACE_DIR);
    expect(files.length).toBeGreaterThan(0); // 反空转。
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("pg-run-image-input");
      expect(source).not.toContain("RunImagePort");
    }
  });
});
