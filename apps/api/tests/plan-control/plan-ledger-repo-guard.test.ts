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
