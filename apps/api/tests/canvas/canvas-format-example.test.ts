/** #3749 R7: a 4B copied `字段名: 字段值` verbatim — nine lines of spec where values belonged. */
import { describe, expect, it } from "vitest";
import { formatExample } from "../../src/application/agent-run/canvas-template-guidance";

const persona = {
  key: "persona", displayName: "用户画像",
  sections: [
    { name: "姓名", type: "短文本" as const, layout: null },
    { name: "年龄", type: "短文本" as const, layout: null },
    { name: "用户描述", type: "便签" as const, layout: null },
    { name: "目标和需求", type: "便签" as const, layout: null },
  ],
};

describe("formatExample", () => {
  it("uses the real key, all fields and first section when exactly one template is injected", () => {
    const lines = formatExample([persona as never]);
    expect(lines[0]).toBe("模板: persona");
    expect(lines[1]).toContain("姓名:");
    expect(lines[1]).toContain("不要写「姓名」四个字本身");
    expect(lines[2]).toContain("年龄:");
    expect(lines[3]).toBe("## 用户描述");
  });

  it("falls back to angle-bracket placeholders when several templates are listed", () => {
    const lines = formatExample([persona as never, { ...persona, key: "swot" } as never]);
    expect(lines[0]).toBe("模板: <模板key>");
    expect(lines.join("\n")).not.toContain("字段名: 字段值");
  });
});


it("includes every journey stage definition in the generated format example", () => {
  const stages = Array.from({ length: 5 }, (_, i) => ({ name: `阶段${i + 1}`, type: "短文本", layout: null }));
  const lines = formatExample([{ key: "journey-map", displayName: "用户旅程图", sections: [...stages, { name: "行为 · 阶段1", type: "便签", layout: null }] }]);
  for (const stage of stages) expect(lines.some(line => line.startsWith(`${stage.name}:`))).toBe(true);
});
