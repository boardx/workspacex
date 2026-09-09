import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `backend-required` 的两处声明必须一致：workflow 的 `needs` 与
 * `.harness/config/ci-check-policy.json` 的 `aggregates`。
 *
 * ⚠ 这条是 2026-09-09 接入 `prototype-audit` 时**差点踩进去**的坑：
 * `ci-backend-required.mjs` 判的是**策略文件**里的依赖列表，不是 workflow 的 `needs`。
 * 只往 `needs` 里加一个 job，它会被跑、会红，但 `backend-required` **根本不看它**——
 * 一道「量了但不判」的门，比没有门更坏，因为它看起来是有的。
 *
 * 反过来也一样：只往策略里加而 workflow 没有这个 job，`needs` 里拿不到它的结果，
 * 聚合器会把 `undefined !== 'success'` 判成失败，`backend-required` 永远红。
 *
 * 本仓那条「同一事实不得声明在两处」——这里两处都必须存在（一处给 GitHub 调度、
 * 一处给版本化策略），所以配一道机械门控让它们不许漂移。
 */
describe("backend-required 的依赖：workflow 与策略文件不许漂移", () => {
  const workflow = readFileSync(".github/workflows/backend-gates.yml", "utf8");
  const policy = JSON.parse(readFileSync(".harness/config/ci-check-policy.json", "utf8")) as {
    aggregates: Record<string, string[]>;
  };

  const needsLine = workflow
    .split("\n")
    .find((l) => l.trim().startsWith("needs: [") && l.includes("gates-fast"));

  it("解析得到 workflow 的 needs（解析不出就红，不许静默跳过）", () => {
    expect(needsLine, "找不到 backend-required 的 needs 行——解析器与 workflow 漂移了").toBeDefined();
  });

  it("两处的依赖集合逐项相等", () => {
    const fromWorkflow = (needsLine ?? "")
      .slice((needsLine ?? "").indexOf("[") + 1, (needsLine ?? "").lastIndexOf("]"))
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const fromPolicy = policy.aggregates["backend-required"] ?? [];

    expect(fromWorkflow.length, "workflow 的 needs 解析成空集——拒绝下判断").toBeGreaterThan(0);
    expect([...fromWorkflow].sort()).toEqual([...fromPolicy].sort());
  });

  it("prototype-audit 在两处都在（截图审计门真的会拦合并）", () => {
    expect(workflow).toContain("prototype-audit:");
    expect(policy.aggregates["backend-required"]).toContain("prototype-audit");
  });
});
