import { describe, expect, it } from "vitest";
import { stripControlMarkersForDisplay } from "@/lib/chat-control-markers";
import { workSkillDisplayName } from "@/lib/work-skill-display-copy";
import { catalogWorkflowTitleZh } from "@/lib/workflow-catalog-title-copy";

describe("显示层剥离回环控制标记", () => {
  it("去掉 request_handoff / escalate / start_workflow / evidence 标记，保留正文", () => {
    expect(stripControlMarkersForDisplay("UIUX 这个需求请产品经理接手 [request_handoff:D003]")).toBe("UIUX 这个需求请产品经理接手");
    expect(stripControlMarkersForDisplay("[escalate:客户要求超额折扣]")).toBe("");
    expect(stripControlMarkersForDisplay("做 [start_workflow:W001] 并附 [evidence:e1]")).toBe("做 并附");
  });
  it("普通方括号原样保留", () => {
    expect(stripControlMarkersForDisplay("看 [1] 和 [note]")).toBe("看 [1] 和 [note]");
  });
});

describe("技能/工作流中文显示名", () => {
  it("稳定编号换中文名，查不到返回 null；普通名原样", () => {
    expect(workSkillDisplayName("S061")).toBe("产品探索");
    expect(workSkillDisplayName("S999")).toBeNull();
    expect(workSkillDisplayName("周报助手")).toBe("周报助手");
  });
  it("目录英文 title 换中文", () => {
    expect(catalogWorkflowTitleZh("Research-to-Brief")).toBe("研究到简报");
    expect(catalogWorkflowTitleZh("W001 Research-to-Brief")).toBe("研究到简报");
  });
});
