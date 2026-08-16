/**
 * F190 —— 把 `pg-tool-trace-context.ts` 那条 `lint-permission-paths` 豁免的**前提**钉成机械
 * 事实（同 `agent-run-context-snapshot-repo-guard.test.ts` 的形状）。
 *
 * 豁免的理由有两半，两半都在这里被断言：
 *
 *   (a) 仓储本身只名到 `agent_runs`/`agent_run_steps`/`chat_messages` 三张表——一旦有人
 *       在这里 JOIN 上别的租户表，它就变成了一个未经判定的内容读出口。
 *   (b) `PgToolTraceContext.recent` 只被 `execute-run.ts`（经 `agent-run-executor.ts`）调用，
 *       `src/interface/` 下没有任何 controller 直接触达它——它是组装用的内部素材，不是
 *       面向请求者的披露面。
 *
 * 这个文件被删掉时，allowlist 里那一行必须跟着删。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(__dirname, "../../src/infrastructure/agent-run/pg-tool-trace-context.ts");
const EXECUTOR = join(__dirname, "../../src/infrastructure/agent-run/agent-run-executor.ts");
const INTERFACE_DIR = join(__dirname, "../../src/interface");

/** 先剥注释再扫——同既有 repo-guard 测试的先例：头注逐字提到表名，直接对全文匹配会
 *  被自己的说明文字触发。 */
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

describe("F190 pg-tool-trace-context 仓储的权限豁免前提", () => {
  const repoSource = code(readFileSync(REPO, "utf8"));
  const executorSource = code(readFileSync(EXECUTOR, "utf8"));

  it("(a) 仓储只名到 agent_runs / agent_run_steps / chat_messages 三张表", () => {
    // CTE 别名（`WITH recent_runs AS (...)`）不是租户表——它是本文件自己定义的中间结果，
    // 后续 `FROM recent_runs` 引用的是这个 CTE，不是数据库里的另一张表，要从候选里剔除。
    const cteNames = [...repoSource.matchAll(/\bWITH\s+([a-z_][a-z0-9_]*)\s+AS\s*\(/gi)]
      .map((m) => m[1]!.toLowerCase());
    const named = [...repoSource.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_][a-z0-9_]*)/gi)]
      .map((m) => m[1]!.toLowerCase())
      .filter((name) => name !== "set" && !cteNames.includes(name));
    expect(named.length).toBeGreaterThan(0); // 反空转：匹配器必须真的匹配到东西。
    expect([...new Set(named)].sort()).toEqual(["agent_run_steps", "agent_runs", "chat_messages"]);
  });

  it("(a) 之二：仓储没有 withoutTenant——那条路会关掉 RLS", () => {
    expect(repoSource).not.toContain("withoutTenant");
    expect(repoSource).toContain("withTenant");
  });

  it("(b) agent-run-executor.ts 把 toolTrace 原样转给 execute-run.ts，本身不直接调用 .recent(", () => {
    // executor 只是把端口对象转发进 deps；真正调用 `.recent(` 的是 execute-run.ts。
    expect(executorSource).toContain("toolTrace: this.toolTrace");
    expect(executorSource).not.toContain(".recent(");
  });

  it("(b) 之二：src/interface/ 下没有任何 controller 直接调用 .recent( 或 import 这个仓储", () => {
    const files = walkTsFiles(INTERFACE_DIR);
    expect(files.length).toBeGreaterThan(0); // 反空转。
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("pg-tool-trace-context");
      expect(source).not.toContain("ToolTraceContextPort");
    }
  });
});
