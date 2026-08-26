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
  it("src/interface/ 下只有 copilotkit-agui.controller.ts 引用 ingest-engine-plan-snapshot（UC-2 的唯一触发路径，usecases.md 逐字要求）", () => {
    const offenders = filesUnder(interfaceDir).filter((f) => {
      const text = readFileSync(f, "utf8");
      return text.includes("ingest-engine-plan-snapshot") || text.includes("ingestEnginePlanSnapshot");
    });
    expect(offenders.map((f) => f.split("/src/interface/")[1]?.replace(/^\/+/, ""))).toEqual([
      "controllers/copilotkit-agui.controller.ts",
    ]);
  });
});

describe("白名单条目前提 ④：读路径（getPlanLedger）本 feature 未接 HTTP controller", () => {
  it("src/interface/ 下没有文件引用 get-plan-ledger 用例——一旦 F977 之后接了真实 GET 路由，" +
     "那个 controller 必须先过 chat UC-0 的可见性判定再调这个仓储（usecases.md UC-1 的 pre 条款），" +
     "而不是把这条豁免继续续下去；接线那天这条断言会先红，提醒改掉这条豁免", () => {
    const offenders = filesUnder(interfaceDir).filter((f) => {
      const text = readFileSync(f, "utf8");
      return text.includes("get-plan-ledger") || text.includes("getPlanLedger(");
    });
    expect(offenders).toEqual([]);
  });
});
