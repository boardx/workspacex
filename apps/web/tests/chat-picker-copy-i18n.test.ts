import { expect, it } from "vitest";
import { workflowLabel } from "@/lib/workflow-catalog-title-copy";
import { autoExamplePrompts, joinWithOverflow, pendingWorkflowLabels, reasonCopy } from "@/lib/capability-picker-model";

it("localizes known built-in workflow display while preserving a custom workflow name exactly", () => {
  expect(workflowLabel({ stableId:"W029",name:"Problem-to-PRD" },"en")).toBe("Problem to PRD");
  expect(workflowLabel({ stableId:"custom-raw",name:"用户自定义流程（完整原名）" },"en")).toBe("用户自定义流程（完整原名）");
});
it("localizes owned overflow wording without rewriting raw items", () => {
  const items = ["用户甲","Raw B","原名C"];
  expect(joinWithOverflow(items,2,"en")).toBe("用户甲, Raw B and 1 more");
  expect(joinWithOverflow(items,2)).toBe("用户甲、Raw B 等 3 个");
  expect(items).toEqual(["用户甲","Raw B","原名C"]);
});
it("localizes existing availability categories without exposing unknown upstream diagnostic text", () => {
  expect(reasonCopy("permission denied", "en").short).toBe("No permission");
  const result=reasonCopy("https://private-service.invalid/internal-secret", "en");
  expect(result.short).toBe("Unavailable");
  expect(result.full).not.toContain("private-service");
});
it("keeps pending workflow identities/counts canonical while localizing only known display labels", () => {
  const input={workflowAllowlist:["W029","unknown-raw"]};
  expect(pendingWorkflowLabels(input,"en")).toEqual({labels:["Problem to PRD"],unknown:1});
  expect(input.workflowAllowlist).toEqual(["W029","unknown-raw"]);
});
it("offers authored English preview examples while default Chinese examples remain compatible", () => {
  expect(autoExamplePrompts([],"en")).toContain("Help me organize the key points of this task");
  expect(autoExamplePrompts([])).toContain("帮我整理一下这件事的要点");
});
