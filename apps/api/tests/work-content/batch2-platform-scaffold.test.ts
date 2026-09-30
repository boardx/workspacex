/**
 * 批次 2 平台脚手架（纯函数，不连数据库）：
 * - 阶段 Workflow 编号集互不相交，W017 不属于任何阶段；
 * - 槽位 ↔ 目录线 ↔ 阶段集合一致；shared/operations 目录已接入白名单寻址，并恰好登记各自线的槽位（W017 仍查不到）；
 * - 槽位 key 唯一；
 * - 新增分类全部已登记；批次 2 写类分类可授权（默认只读由「无配置行」保证）。
 */
import { describe, expect, it } from "vitest";
import { BATCH2_WORKFLOW_SLOTS, DEFERRED_WORKFLOW_IDS, PHASE_WORKFLOW_IDS, workflowIdPhase } from "@repo/contracts/work-content";
import { contentWorkflowIdOf, contentWorkflowKeyOf } from "../../src/domain/agent/workflow-allowlist";
import { OPERATIONS_WORKFLOW_DEFINITIONS } from "../../src/domain/work-content/definitions/operations";
import { SHARED_WORKFLOW_DEFINITIONS } from "../../src/domain/work-content/definitions/shared";
import { SALES_WORKFLOW_DEFINITIONS } from "../../src/domain/work-content/definitions/sales";
import { RESEARCH_WORKFLOW_DEFINITIONS } from "../../src/domain/work-content/definitions";
import { PRODUCT_LINE_WORKFLOWS } from "../../src/domain/work-content/product-workflow-definitions";
import { isRegisteredCapabilityCategory, PLANNED_WORKFLOW_SIDE_EFFECT_CATEGORIES } from "../../src/domain/skill/capability-category-registry";
import { grantableCategories } from "../../src/application/workflow/workflow-capability-grants";

describe("per-phase workflow id sets", () => {
  it("phase1 has 19 ids, batch2 has 7, no overlaps, W017 in neither", () => {
    expect(PHASE_WORKFLOW_IDS.phase1).toHaveLength(19);
    expect(PHASE_WORKFLOW_IDS.batch2).toHaveLength(7);
    const all = [...PHASE_WORKFLOW_IDS.phase1, ...PHASE_WORKFLOW_IDS.batch2];
    expect(new Set(all).size).toBe(all.length);
    for (const id of DEFERRED_WORKFLOW_IDS) {
      expect(all).not.toContain(id);
      expect(workflowIdPhase(id)).toBe("deferred");
    }
    expect(workflowIdPhase("W003")).toBe("batch2");
    expect(workflowIdPhase("W011")).toBe("phase1");
    expect(workflowIdPhase("W999")).toBe("unknown");
  });

  it("registered catalogs only contain phase1/batch2 ids (W017 never registered)", () => {
    const registered = [
      ...PRODUCT_LINE_WORKFLOWS.map((d) => d.workflowId),
      ...RESEARCH_WORKFLOW_DEFINITIONS.map((d) => d.id),
      ...SALES_WORKFLOW_DEFINITIONS.map((d) => d.workflowId),
      ...SHARED_WORKFLOW_DEFINITIONS.map((d) => d.workflowId),
      ...OPERATIONS_WORKFLOW_DEFINITIONS.map((d) => d.workflowId),
    ];
    for (const id of registered) expect(["phase1", "batch2"]).toContain(workflowIdPhase(id));
    expect(registered).not.toContain("W017");
  });
});

describe("batch2 slots", () => {
  it("slots cover exactly the batch2 id set; line matches the catalog it will live in", () => {
    expect(BATCH2_WORKFLOW_SLOTS.map((s) => s.workflowId).sort()).toEqual([...PHASE_WORKFLOW_IDS.batch2].sort());
    for (const s of BATCH2_WORKFLOW_SLOTS) expect(["shared", "operations"]).toContain(s.line);
  });

  it("slot keys are unique and resolve to exactly the registered definition in the catalog of their line", () => {
    expect(SHARED_WORKFLOW_DEFINITIONS.map((d) => d.workflowId)).toEqual(["W003", "W004", "W007"]);
    expect(OPERATIONS_WORKFLOW_DEFINITIONS.map((d) => d.workflowId)).toEqual(["W052", "W053", "W055", "W056"]);
    for (const s of BATCH2_WORKFLOW_SLOTS) {
      expect(contentWorkflowIdOf(s.key)).toBe(s.workflowId);
      expect(contentWorkflowKeyOf(s.workflowId)).toBe(s.key);
    }
    expect(new Set(BATCH2_WORKFLOW_SLOTS.map((s) => s.key)).size).toBe(BATCH2_WORKFLOW_SLOTS.length);
    // W017 推迟：任何目录都查不到。
    expect(contentWorkflowKeyOf("W017")).toBeNull();
  });
});

describe("batch2 capability categories", () => {
  it("planned side-effect categories are registered and grantable", () => {
    const grantable = grantableCategories();
    for (const c of PLANNED_WORKFLOW_SIDE_EFFECT_CATEGORIES) {
      expect(isRegisteredCapabilityCategory(c)).toBe(true);
      expect(grantable.has(c)).toBe(true);
    }
    for (const c of ["incident.read", "monitoring.read", "deploy.read", "directory.read", "workforce.schedule.read"]) {
      expect(isRegisteredCapabilityCategory(c)).toBe(true);
    }
  });
});
