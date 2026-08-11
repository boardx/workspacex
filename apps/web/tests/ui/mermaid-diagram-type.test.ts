/**
 * VZ-01 —— `resolveDiagramType` 白名单闸门（纯函数）。单源反证：白名单**每一种**都判在内，
 * 越界的判在外并保留原 token 供诚实展示。白名单不在此复述，遍历契约枚举断言全覆盖。
 */
import { describe, expect, it } from "vitest";
import { canvas } from "@repo/contracts";
import { resolveDiagramType } from "@/lib/mermaid-diagram-type";

describe("resolveDiagramType", () => {
  it("契约 MermaidDiagramType 每一种都判在白名单内（全覆盖，防漏）", () => {
    for (const t of canvas.MermaidDiagramType.options) {
      // 用「首 token = 枚举名」的最简围栏喂进去。
      const r = resolveDiagramType(`${t}\n  A --> B`);
      expect(r.inWhitelist, `${t} 应在白名单`).toBe(true);
      expect(r.type).toBe(t);
    }
  });

  it("`graph TD` 别名 → flowchart（mermaid 经典写法）", () => {
    const r = resolveDiagramType("graph TD\n  A --> B");
    expect(r.inWhitelist).toBe(true);
    expect(r.type).toBe("flowchart");
  });

  it("越界图类型 → 不在白名单，type=null，rawToken 原样保留（诚实展示）", () => {
    const r = resolveDiagramType("xychart-beta\n  title \"x\"\n  line [1,2]");
    expect(r.inWhitelist).toBe(false);
    expect(r.type).toBeNull();
    expect(r.rawToken).toBe("xychart-beta");
  });

  it("跳过 %% 注释行与空行取首 token", () => {
    const r = resolveDiagramType("\n%% 这是注释\n\nsequenceDiagram\n  A->>B: hi");
    expect(r.type).toBe("sequenceDiagram");
  });
});
