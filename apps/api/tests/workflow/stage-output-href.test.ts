/** 阶段产出链接必须指向前端产出页——API 没有 `/workflow-instances/:id/outputs/:id` 路由（旧链接 404）。 */
import { describe, expect, it } from "vitest";
import { workContent } from "@repo/contracts";
import { stageOutputHref } from "../../src/application/workflow/instance-projection";

describe("stageOutputHref", () => {
  it("指向 /workflows/runs/:id/result 并带 output 查询参数（编码）", () => {
    expect(stageOutputHref("wi 1", "out/1")).toBe("/workflows/runs/wi%201/result?output=out%2F1");
  });
  it("不再生成无路由的 API 形状", () => {
    expect(stageOutputHref("wi-1", "o1")).not.toContain("/workflow-instances/");
    // 产出正文由 UC-WC-3 读取，契约路径不变。
    expect(workContent.operations.getInstanceOutput.path).toBe("/workflow-instances/:instanceId/output");
  });
});
