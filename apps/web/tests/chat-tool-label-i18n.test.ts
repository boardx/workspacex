import { expect, it } from "vitest";
import { toolLabel, toolObject } from "@/lib/chat-workbench/tool-label";
it("renders known tool names in the requested locale with legacy Chinese compatibility", () => {
  expect(toolLabel("read_file", "en")).toBe("Read file");
  expect(toolLabel("start_workflow", "en")).toBe("Start workflow");
  expect(toolLabel("wx_remember", "en")).toBe("Suggest remembering (confirmation required)");
  expect(toolLabel("read_file")).toBe("读取文件");
  expect(toolLabel("start_workflow", "zh-CN")).toBe("发起流程");
});
it("preserves unknown tool identity and original argument projections", () => {
  const tool = "组织工具{count}🌍";
  expect(toolLabel(tool, "en")).toBe(tool); expect(toolLabel(tool, "zh-CN")).toBe(tool);
  const args = { file_path: "/private/用户文件{count}.txt", command: "原始指令🌍" };
  expect(toolObject(tool, args)).toBe("用户文件{count}.txt");
  expect(args).toEqual({ file_path: "/private/用户文件{count}.txt", command: "原始指令🌍" });
});
