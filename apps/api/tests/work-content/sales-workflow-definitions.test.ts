/**
 * sales-workflow-definitions.test.ts —— Phase 20 CT08（`05-content-lines.md` R3 步骤 8/9；E2；I-C4/I-C10）。
 *
 * - 七个销售线定义都能产出合法的 runtime Definition 元数据（graphRef = key:version，阶段 = 图节点）。
 * - W011：admit → intake → enrich（S021 并发 5）→ tier → triage → hygiene → G1 → write_back → notify。
 * - W013：G1 三联绑定 (recordDigest, framingDecision, changeSetDigest)；新商机只五字段、amount/closeDate/stage 延后；
 *   G2 + mail.send 独立；所有门都不允许自动批准。
 * - 注册：按 work-sales 包解析 pin；未解析引用只让该 Workflow 不可用（带 unresolvedPins），其它照常可用。
 */
import { describe, expect, it } from "vitest";
import { WorkflowDefinitionVersionInput } from "@repo/contracts/workflow-runtime";
import { WorkflowCatalogItem } from "@repo/contracts/work-content";
import {
  SALES_WORKFLOW_DEFINITIONS,
  W011,
  W013,
  W018,
} from "../../src/domain/work-content/definitions/sales";
import {
  exactVersionResolver,
  registerWorkflowDefinitions,
  toDefinitionVersionInput,
  type WorkContentWorkflowModule,
} from "../../src/domain/work-content/workflow-definition-module";
import { buildWorkSalesPack } from "../../scripts/build-work-sales-skill-pack";

const packResolver = () =>
  exactVersionResolver(buildWorkSalesPack().skills.map((s) => ({ stableId: s.name, semanticVersion: s.semanticVersion })));

describe("CT08 · 销售线 Workflow 定义", () => {
  it("每个定义都产出合法 runtime 元数据，graphRef = key:version", () => {
    for (const def of SALES_WORKFLOW_DEFINITIONS) {
      const input = toDefinitionVersionInput(def);
      expect(WorkflowDefinitionVersionInput.safeParse(input).success).toBe(true);
      expect(input.graphRef).toBe(`${def.key}:1`);
      for (const g of def.gates) expect(def.stages.some((s) => s.stageId === g.stageId)).toBe(true);
      for (const g of def.gates) expect(g.autoApprove).toBe(false);
    }
  });

  it("W011 阶段顺序与 §5 一致，S021 扩充并发 5，G1 在 review，写回 crm.write + 通知 notify.inapp", () => {
    expect(W011.stages.map((s) => s.stageId)).toEqual([
      "admit", "intake", "enrich", "tier", "triage", "hygiene", "review", "write_back", "notify",
    ]);
    const skillOf = (id: string) => W011.stages.find((s) => s.stageId === id)!.skills.map((r) => r.stableId);
    expect(skillOf("intake")).toEqual(["S024"]);
    expect(skillOf("enrich")).toEqual(["S021"]);
    expect(skillOf("tier")).toEqual(["S022"]);
    expect(skillOf("triage")).toEqual(["S025"]);
    expect(skillOf("hygiene")).toEqual(["S034"]);
    expect(W011.stages.find((s) => s.stageId === "enrich")!.fanOutConcurrency).toBe(5);
    expect(W011.stages.find((s) => s.stageId === "review")!.humanGate).not.toBeNull();
    expect(W011.stages.find((s) => s.stageId === "write_back")!.capabilityCategories).toEqual(["crm.write"]);
    expect(W011.gates.map((g) => [g.gateId, g.stageId])).toEqual([["G1", "review"]]);
  });

  it("W013 会后三联决策：G1 绑定三份 digest，新商机五字段、延后 amount/closeDate/stage，G2 + mail.send 独立", () => {
    const g1 = W013.gates.find((g) => g.gateId === "G1")!;
    expect(g1.stageId).toBe("review");
    expect(g1.binds).toEqual(["recordDigest", "framingDecision", "changeSetDigest"]);
    const order = W013.stages.map((s) => s.stageId);
    for (const before of ["summarize", "frame", "plan_update"]) expect(order.indexOf(before)).toBeLessThan(order.indexOf("review"));
    expect(W013.constraints!.newOpportunityFields).toEqual(["accountId", "name", "initialStage", "ownerId", "sourceMeetingRef"]);
    expect([...W013.constraints!.deferredProposalFields!].sort()).toEqual(["amount", "closeDate", "stage"]);
    expect(W013.constraints!.newOpportunityFields).not.toEqual(expect.arrayContaining(["amount"]));
    const g2 = W013.gates.find((g) => g.gateId === "G2")!;
    expect(order.indexOf(g2.stageId)).toBeGreaterThan(order.indexOf("apply"));
    const send = W013.stages.find((s) => s.stageId === "send_followup")!;
    expect(send.capabilityCategories).toEqual(["mail.send"]);
    expect(send.sideEffect).toBe("external_send");
    expect(order.indexOf("send_followup")).toBeGreaterThan(order.indexOf(g2.stageId));
  });

  it("W018 S021 与 S009 同属 gathering 并行组", () => {
    const groups = W018.stages.filter((s) => s.parallelGroup === "gathering").map((s) => s.skills[0]!.stableId);
    expect(groups).toEqual(["S021", "S009"]);
  });

  it("按 work-sales 包注册：pin 全部可解析的可用；W012 引用未入包的 S027 → 仅它不可用", () => {
    const items = registerWorkflowDefinitions(SALES_WORKFLOW_DEFINITIONS, packResolver());
    for (const item of items) expect(WorkflowCatalogItem.safeParse(item).success).toBe(true);
    const byId = new Map(items.map((i) => [i.workflowId, i]));
    for (const id of ["W011", "W013", "W014", "W015", "W016", "W018"]) {
      expect(byId.get(id)!.availability, id).toBe("available");
      expect(byId.get(id)!.unresolvedPins).toEqual([]);
    }
    const w012 = byId.get("W012")!;
    expect(w012.availability).toBe("unavailable");
    expect(w012.unavailableReason).toBe("workflow_skill_pin_unresolved");
    expect(w012.unresolvedPins).toEqual([{ skillId: "S027", semanticVersion: "1.0.0" }]);
  });

  it("未解析引用报错不影响其它：去掉 S009 只让 W013/W018 不可用", () => {
    const entries = buildWorkSalesPack()
      .skills.filter((s) => s.name !== "S009")
      .map((s) => ({ stableId: s.name, semanticVersion: s.semanticVersion }));
    const items = registerWorkflowDefinitions(SALES_WORKFLOW_DEFINITIONS, exactVersionResolver([...entries, { stableId: "S027", semanticVersion: "1.0.0" }]));
    const unavailable = items.filter((i) => i.availability === "unavailable").map((i) => i.workflowId);
    expect(unavailable).toEqual(["W013", "W018"]);
    for (const i of items.filter((x) => x.availability === "unavailable")) {
      expect(i.unresolvedPins).toEqual([{ skillId: "S009", semanticVersion: "1.0.0" }]);
    }
  });

  it("版本不匹配也算未解析；形状非法的模块只把自己标为不可用", () => {
    const broken: WorkContentWorkflowModule = { ...W011, workflowId: "W011", key: "Bad Key" };
    const items = registerWorkflowDefinitions(
      [broken, W018],
      exactVersionResolver([{ stableId: "S021", semanticVersion: "2.0.0" }, { stableId: "S009", semanticVersion: "1.0.0" }, { stableId: "S035", semanticVersion: "1.0.0" }, { stableId: "S023", semanticVersion: "1.0.0" }, { stableId: "S036", semanticVersion: "1.0.0" }]),
    );
    expect(items[0]!.availability).toBe("unavailable");
    expect(items[1]!.availability).toBe("unavailable");
    expect(items[1]!.unresolvedPins).toEqual([{ skillId: "S021", semanticVersion: "1.0.0" }]);
  });
});
