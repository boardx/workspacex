/**
 * CT09 线索写回 —— 生产上「未配置 CRM」时没有任何用户可见入口能走到它（产品决定：暂不接 CRM）。
 *
 * 生产装配（`kernel.module.ts` → `createProductionWorkflowRuntime`）不传 `leadWriteBack`（没有生产
 * TenantCrmPort / InAppNotifyPort），所以 `LeadWriteBackService` 为 null；而能走到它的唯一路径是
 * 发起 W011 运行。本测试钉住那条路径在生产上是断的：
 *   - W011 的图不在生产运行时的图注册表里（`publishDefinitionVersion` 要求「图已注册」，发布不了）；
 *   - W011 不在内置 Definition（dev-mode 种子 / bring-up 导入）里 ⇒ 不会出现在「运行 Workflow」可运行列表；
 *   - 契约里的线索决定卡读 / 写（`getLeadDecisionCard` / `decideLeadItems`）没有挂任何 HTTP 路由。
 * 若将来接入 CRM，这里会红——届时须同时补「未配置 CRM」的降级态（契约束 work-content ui.md §三）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { operations } from "@repo/contracts/work-content";
import { W011 } from "../../src/domain/work-content/definitions/sales";
import { builtInWorkflowDefinitions, defaultWorkflowGraphs } from "../../src/infrastructure/workflow/create-workflow-runtime";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("CT09 未配置 CRM：线索写回在生产上不可达", () => {
  it("W011 的图不在生产图注册表里", () => {
    const refs = defaultWorkflowGraphs().map((g) => g.graphRef);
    expect(refs).not.toContain(`${W011.key}:${W011.version}`);
  });

  it("W011 不在内置 Definition 里（不会进可运行列表）", () => {
    expect(builtInWorkflowDefinitions().map((d) => d.key)).not.toContain(W011.key);
  });

  it("线索决定卡读 / 写没有挂 HTTP 路由；生产装配不传 leadWriteBack", () => {
    const files = walk(join(SRC, "interface"));
    const paths = [operations.getLeadDecisionCard.path, operations.decideLeadItems.path];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text.includes("getLeadDecisionCard") || text.includes("decideLeadItems"), f).toBe(false);
      for (const p of paths) expect(text.includes(p), `${f} mounts ${p}`).toBe(false);
    }
    expect(readFileSync(join(SRC, "kernel.module.ts"), "utf8")).not.toMatch(/leadWriteBack\s*:/);
  });
});
