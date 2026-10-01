import { describe, expect, it } from "vitest";
import { BATCH2_WORKFLOW_SLOTS } from "@repo/contracts/work-content";
import { findBuiltinWorkflow } from "@/lib/workflow-display-copy";
import { capabilityCopy } from "@/lib/workflow-capability-grant-copy";

describe("batch2 workflow display copy", () => {
  it("every slot has a Chinese name keyed by the same workflowId and key", () => {
    for (const s of BATCH2_WORKFLOW_SLOTS) {
      const hit = findBuiltinWorkflow(s.key);
      expect(hit?.workflowId).toBe(s.workflowId);
      expect(hit?.name).not.toBe(s.title);
      expect(findBuiltinWorkflow(s.workflowId)?.key).toBe(s.key);
    }
  });

  it("new write categories have their own grant copy (not the generic fallback)", () => {
    const fallback = capabilityCopy("x.unknown").label;
    for (const c of ["ticket.write", "tracker.write", "kb.publish", "docs.publish", "project.write", "project.member.write", "knowledge.graph.write", "board.write"]) {
      expect(capabilityCopy(c).label).not.toBe(fallback);
    }
  });
});
