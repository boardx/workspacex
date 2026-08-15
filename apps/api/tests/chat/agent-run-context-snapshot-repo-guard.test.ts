/**
 * F157 —— 把 `pg-agent-run-context-snapshot.ts` 那条 `lint-permission-paths` 豁免的**前提**
 * 钉成机械事实，而不是只写在 allowlist 的理由里（同 `thread-mount-repo-guard.test.ts` 的形状）。
 *
 * 豁免的理由有两半，两半都在这里被断言：
 *
 *   (a) 仓储本身只名到 `agent_run_context_snapshots` 一张表。一旦有人在这里 JOIN 上
 *       别的租户表，它就变成了一个未经判定的内容读出口。
 *   (b) `readAgentRunContextSnapshot`（application 层用例）在调用
 *       `deps.snapshots.findByRunId` 之前，一定先调 `resolveVisibility`，且拒绝时
 *       抛出、绝不往下读——判权在仓储之前，同 F119/F124/F125/#467 那批条目一致的顺序。
 *
 * 这个文件被删掉时，allowlist 里那一行必须跟着删。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(__dirname, "../../src/infrastructure/agent-run/pg-agent-run-context-snapshot.ts");
const USE_CASE = join(__dirname, "../../src/application/agent-run/read-run-context-snapshot.ts");

/** 先剥注释再扫——同 thread-mount 那条既有先例：本文件的头注逐字提到表名/方法名，
 * 直接对全文 `toContain`/正则会被自己的说明文字触发。 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("F157 agent_run_context_snapshots 仓储的权限豁免前提", () => {
  const repoSource = code(readFileSync(REPO, "utf8"));
  const useCaseSource = code(readFileSync(USE_CASE, "utf8"));

  it("(a) 仓储只名到 agent_run_context_snapshots 一张表：FROM / INTO / UPDATE / JOIN 后面没有第二个表名", () => {
    const named = [...repoSource.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_][a-z0-9_]*)/gi)]
      .map((m) => m[1]!.toLowerCase())
      .filter((name) => name !== "set"); // `SET` 是 UPDATE 子句关键字，不是表名。
    expect(named.length).toBeGreaterThan(0); // 反空转：匹配器必须真的匹配到东西。
    expect([...new Set(named)]).toEqual(["agent_run_context_snapshots"]);
  });

  it("(a) 之二：仓储没有 withoutTenant——那条路会关掉 RLS", () => {
    expect(repoSource).not.toContain("withoutTenant");
    expect(repoSource).toContain("withTenant"); // 正样本：确实用了带租户的那条。
  });

  it("(b) readAgentRunContextSnapshot 在调用 findByRunId 之前先调 resolveVisibility，且拒绝时抛出", () => {
    const fnBody = /export async function readAgentRunContextSnapshot[\s\S]*$/.exec(useCaseSource)?.[0] ?? "";
    expect(fnBody).not.toBe("");
    const resolveIndex = fnBody.indexOf("resolveVisibility(");
    const findIndex = fnBody.indexOf("findByRunId(");
    expect(resolveIndex).toBeGreaterThan(-1);
    expect(findIndex).toBeGreaterThan(-1);
    expect(resolveIndex).toBeLessThan(findIndex); // 判权先于仓储调用。

    // 拒绝分支在 resolveVisibility 与 findByRunId 之间，且真的 throw（不是记个日志继续走）。
    const between = fnBody.slice(resolveIndex, findIndex);
    expect(between).toContain("outcome.kind !== \"allow\"");
    expect(between).toContain("throw new AgentRunContextSnapshotNotVisibleError()");
  });

  it("(b) 之二：用例文件本身也 import 了 resolveVisibility——不是巧合命中同名字符串", () => {
    expect(useCaseSource).toContain("import { resolveVisibility");
  });
});
