// role-freeze.test.ts — H3A-004 的反证。纯函数，喂构造的角色文件列表，
// 不碰文件系统（真实文件的活体验证在 PR 描述里）。
import { describe, expect, it } from "vitest";
import { findUnregisteredRoles } from "./role-freeze";

describe("findUnregisteredRoles", () => {
  it("基线：全部角色都在 registry 里 → 零 finding", () => {
    const findings = findUnregisteredRoles(
      [{ sourceFile: "roles/coord-main.yaml", name: "coord-main" }],
      new Set(["coord-main"]),
    );
    expect(findings).toEqual([]);
  });

  it("🔴 角色不在 registry 里 → WARN finding，点名文件和角色名", () => {
    const findings = findUnregisteredRoles(
      [{ sourceFile: "roles/dev-shadow.yaml", name: "dev-shadow" }],
      new Set(["coord-main"]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("WARN");
    expect(findings[0]!.sourceFile).toBe("roles/dev-shadow.yaml");
    expect(findings[0]!.message).toContain("dev-shadow");
  });

  it("历史条目与新条目一视同仁 —— 不做时间维度区分（同一批文件里没有 git diff 之类的外部输入）", () => {
    // 两个都不在 registry 里，都应该报，函数不偏袒"先出现的那个"。
    const findings = findUnregisteredRoles(
      [
        { sourceFile: "roles/old-one.yaml", name: "old-one" },
        { sourceFile: "roles/new-one.yaml", name: "new-one" },
      ],
      new Set(),
    );
    expect(findings).toHaveLength(2);
  });

  it("🔴 name 字段缺失（null）→ 单独一条 finding，不静默跳过", () => {
    const findings = findUnregisteredRoles(
      [{ sourceFile: "roles/broken.yaml", name: null }],
      new Set(["coord-main"]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("name");
  });

  it("severity 恒为 WARN —— 完成契约原文'WARN，不阻断'，本函数不产生其它严重度", () => {
    const findings = findUnregisteredRoles(
      [{ sourceFile: "x.yaml", name: "unregistered" }],
      new Set(),
    );
    expect(findings.every((f) => f.severity === "WARN")).toBe(true);
  });

  it("多个角色都在 registry 里，混一个不在的 → 只报那一个，不误伤其余", () => {
    const findings = findUnregisteredRoles(
      [
        { sourceFile: "roles/a.yaml", name: "a" },
        { sourceFile: "roles/b.yaml", name: "b" },
        { sourceFile: "roles/c.yaml", name: "c" },
      ],
      new Set(["a", "c"]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.sourceFile).toBe("roles/b.yaml");
  });
});
