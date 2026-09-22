import { describe, it, expect } from "vitest";
import { classifyAgentDocument } from "./agent-spec-discovery";

describe("classifyAgentDocument", () => {
  it("顶层有非空 name 的文档是 agent 规格", () => {
    expect(classifyAgentDocument("code-reviewer.yaml", { name: "code-reviewer", role: "code-reviewer" }))
      .toEqual({ sourceFile: "code-reviewer.yaml", kind: "agent-spec" });
  });

  it("顶层带 agents/developers 列表的文档是身份注册表，不是缺字段的 agent 规格", () => {
    // issue #399 的现场：registry.yaml 本来就不该有 name，它不是 agent 规格。
    expect(
      classifyAgentDocument("registry.yaml", {
        version: 1,
        developers: [{ email: "someone@example.com", github: "someone", role: "maintainer" }],
        agents: [{ id: "coord-main", kind: "coordinator" }],
      }),
    ).toEqual({ sourceFile: "registry.yaml", kind: "registry" });
  });

  it("只有 developers 列表（还没登记任何 agent）也算注册表", () => {
    expect(classifyAgentDocument("registry.yaml", { version: 1, developers: [], agents: [] }))
      .toEqual({ sourceFile: "registry.yaml", kind: "registry" });
  });

  it("既不是注册表、又缺 name 的文档仍然报「缺少 name 字段」——修 #399 不能把真警告一起关掉", () => {
    const result = classifyAgentDocument("broken.yaml", { role: "worker", tools: ["read_files"] });
    expect(result.kind).toBe("unrecognized");
    expect(result.reason).toBe("缺少 name 字段");
  });

  it("顶层不是映射的文档报形状错误", () => {
    expect(classifyAgentDocument("list.yaml", ["a", "b"]).kind).toBe("unrecognized");
    expect(classifyAgentDocument("empty.yaml", null).reason).toBe("顶层不是 YAML 映射");
  });

  it("同时具备两种形状时不替源文件猜，交给人看警告", () => {
    const result = classifyAgentDocument("ambiguous.yaml", { name: "x", agents: [] });
    expect(result.kind).toBe("unrecognized");
    expect(result.reason).toContain("无法判定");
  });

  it("name 为空串/空白不算 agent 规格", () => {
    expect(classifyAgentDocument("blank.yaml", { name: "   " }).kind).toBe("unrecognized");
  });
});
