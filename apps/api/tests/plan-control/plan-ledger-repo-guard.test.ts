/**
 * `lint-permission-paths` 白名单条目（F973）的守卫测试——`pg-plan-ledger-repository.ts`。
 *
 * 同 `tests/itv/theme-repo-permission-guard.test.ts`（F04 同型条目）一样的纪律：白名单
 * 条目声称的前提在这里变成机械断言，不是一句声明。
 *
 * ⛔ **若本文件被删除，`scripts/lint-permission-paths.mjs` 里
 * `pg-plan-ledger-repository.ts` 那条白名单条目必须一并删除。**
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoSource = readFileSync(
  new URL("../../src/infrastructure/plan-control/pg-plan-ledger-repository.ts", import.meta.url), "utf8",
);
const interfaceDir = fileURLToPath(new URL("../../src/interface/", import.meta.url));

function tablesNamedIn(source: string): Set<string> {
  const found = new Set<string>();
  const re = /\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi;
  for (const match of source.matchAll(re)) {
    const name = match[1];
    if (name !== undefined) found.add(name.toLowerCase());
  }
  return found;
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) { out.push(...filesUnder(full)); continue; }
    if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("白名单条目前提 ①：pg-plan-ledger-repository.ts 只命名 chat_plan_ledgers / chat_plan_orphan_constraints / agent_runs", () => {
  it("表名集合恰好是这三张", () => {
    expect(tablesNamedIn(repoSource)).toEqual(
      new Set(["chat_plan_ledgers", "chat_plan_orphan_constraints", "agent_runs"]),
    );
  });
});

describe("白名单条目前提 ②：不调用 withoutTenant", () => {
  it("不出现 withoutTenant", () => {
    expect(repoSource.includes("withoutTenant")).toBe(false);
  });
});

describe("白名单条目前提 ③：写路径（appendEngineSnapshot）只从已授权轮次内部触达", () => {
  it("HTTP 不直接写快照；已授权受理的 run 经 executor 完成事件持久化", () => {
    const source = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const direct = filesUnder(interfaceDir).filter(f => /ingest-engine-plan-snapshot|ingestEnginePlanSnapshot/.test(readFileSync(f, "utf8")));
    expect(direct).toEqual([]);
    const controller = source("interface/controllers/copilotkit-agui.controller.ts");
    expect(controller).toContain("await runAguiBridgeTurn(this.deps,");
    const bridge = source("application/agent-run/agui-bridge.ts");
    expect(bridge).toContain("await acceptHumanMessage(deps,");
    const accept = source("application/chat/message-roundtrip.ts");
    const authorizeAt = accept.indexOf("await resolveVisibility(deps,");
    expect(authorizeAt).toBeGreaterThan(-1);
    expect(accept.indexOf("await deps.commands.accept(")).toBeGreaterThan(authorizeAt);
    const executor = source("application/agent-run/execute-run.ts");
    expect(executor).toContain("await deps.runs.claimQueued(input.orgId,");
    expect(executor).toContain("() => executeClaimed(deps, input.orgId, outcome.run)");
    expect(executor).toContain("await persistToolPlan(deps.planLedger, orgId, run.threadId, event)");
    const events = source("application/agent-run/execute-run-events.ts");
    expect(events).toMatch(/if \(!repo \|\| event.phase === "in_progress" \|\| event.ok === false \|\| event.toolName !== "write_todos"\) return;/);
    expect(events).toContain("await ingestEnginePlanSnapshot(repo, { orgId, threadId, todos: snapshot.todos })");
    // Counter-proof: deleting the actual authorization call cannot leave this gate green.
    const mutated = accept.replace("await resolveVisibility(deps,", "await removedAuthorization(deps,");
    expect(mutated.indexOf("await resolveVisibility(deps,")).toBe(-1);
  });
});

describe("白名单条目前提 ④（F977 更新版）：读路径（getPlanLedger）只从 plan-control.controller.ts 触达，且该 controller 先过 chat UC-0 的可见性判定再调这个仓储", () => {
  // F973 的原始前提是「本 feature 未接 HTTP controller」——那条陷阱已经如期触发：
  // F977 接了真实 GET 路由。这条断言现在核的是接线那天承诺要满足的条件本身
  // （usecases.md UC-1 的 pre 条款：可见性判定委托 chat 束，不在本仓储重复定义），
  // 不是继续假装「没接」。
  it("src/interface/ 下只有 plan-control.controller.ts 引用 get-plan-ledger 用例", () => {
    const offenders = filesUnder(interfaceDir).filter((f) => {
      const text = readFileSync(f, "utf8");
      return text.includes("get-plan-ledger") || text.includes("getPlanLedger(");
    });
    expect(offenders.map((f) => f.split("/src/interface/")[1]?.replace(/^\/+/, ""))).toEqual([
      "controllers/plan-control.controller.ts",
    ]);
  });

  it("plan-control.controller.ts 在调用 getPlanLedger 之前先调用 getThread（chat 束既有可见性判定，同 chat.controller.ts 的 GET /chat/threads/:threadId 复用同一个用例，不重新发明第二套）", () => {
    const text = readFileSync(
      new URL("../../src/interface/controllers/plan-control.controller.ts", import.meta.url), "utf8",
    );
    const getThreadIdx = text.indexOf("getThread(");
    const getPlanLedgerIdx = text.indexOf("getPlanLedger(");
    expect(getThreadIdx, "controller 里找不到 getThread 调用").toBeGreaterThan(-1);
    expect(getPlanLedgerIdx, "controller 里找不到 getPlanLedger 调用").toBeGreaterThan(-1);
    expect(getThreadIdx).toBeLessThan(getPlanLedgerIdx);
  });
});
