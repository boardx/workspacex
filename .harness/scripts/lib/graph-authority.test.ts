// graph-authority.test.ts — H3A-009 的反证。纯函数，喂构造的"路径 + 追踪
// 文件列表"，不碰文件系统（真实文件的活体验证在 PR 描述里：实测跑一遍
// git ls-files）。
import { describe, expect, it } from "vitest";
import { findTrackedProjections, KNOWN_PROJECTION_PATHS } from "./graph-authority";

describe("KNOWN_PROJECTION_PATHS", () => {
  it("合同文档描述的四条都在——数量对得上（本文件与 h3a009 合同文档是同一份清单）", () => {
    expect(KNOWN_PROJECTION_PATHS).toHaveLength(4);
  });
});

describe("findTrackedProjections", () => {
  it("基线：全部路径 trackedFiles 为空 → 零 finding", () => {
    const findings = findTrackedProjections([
      { path: ".harness/state/.cache/", trackedFiles: [] },
      { path: ".harness/templates/instances/", trackedFiles: [] },
    ]);
    expect(findings).toEqual([]);
  });

  it("🔴 某条路径被追踪 → FAIL finding，点名具体文件", () => {
    const findings = findTrackedProjections([
      { path: ".harness/templates/instances/", trackedFiles: [".harness/templates/instances/EVD-x.yaml"] },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("FAIL");
    expect(findings[0]!.message).toContain("EVD-x.yaml");
  });

  it("多条路径混一条被追踪 → 只报那一条，不误伤干净的路径", () => {
    const findings = findTrackedProjections([
      { path: "a/", trackedFiles: [] },
      { path: "b/", trackedFiles: ["b/leaked.json"] },
      { path: "c/", trackedFiles: [] },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.path).toBe("b/");
  });

  it("一条路径被追踪多个文件 → 一条 finding，message 里列全部文件", () => {
    const findings = findTrackedProjections([
      { path: "x/", trackedFiles: ["x/a.json", "x/b.json"] },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("a.json");
    expect(findings[0]!.message).toContain("b.json");
  });
});
