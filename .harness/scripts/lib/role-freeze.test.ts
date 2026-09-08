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

/* ── findRoleMetadataDrift 的反证（2026-09-09 加）──────────────────────
 * kind/areas/reports_to 在 registry.yaml 与 roles/*.yaml 各写一遍，此前只核对
 * name 在不在。每条断言先造一种漂移确认它会红，最后一组是反向反证 + 真仓库取证。
 * ──────────────────────────────────────────────────────────────────── */
import { findRoleMetadataDrift, type RoleMetadata, type RoleMetadataFile } from "./role-freeze";

const file = (over: Partial<RoleMetadataFile> = {}): RoleMetadataFile => ({
  sourceFile: ".harness/agents/roles/r.yaml",
  name: "r",
  kind: "worker",
  areas: ["a", "b"],
  reports_to: "coord-main",
  ...over,
});
const reg = (over: Partial<RoleMetadata> = {}): ReadonlyMap<string, RoleMetadata> =>
  new Map([["r", { kind: "worker", areas: ["a", "b"], reports_to: "coord-main", ...over }]]);

describe("findRoleMetadataDrift", () => {
  it("kind 漂移 ⇒ FAIL 并同时打印两侧的值", () => {
    const f = findRoleMetadataDrift([file()], reg({ kind: "coordinator" }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("FAIL");
    expect(f[0]!.message).toContain("kind 两处不一致");
    expect(f[0]!.message).toContain("role 文件写 worker");
    expect(f[0]!.message).toContain("registry.yaml 写 coordinator");
  });

  it("areas 多一项 / 少一项 / 只是顺序不同，都算漂移", () => {
    expect(findRoleMetadataDrift([file({ areas: ["a", "b", "c"] })], reg())).toHaveLength(1);
    expect(findRoleMetadataDrift([file({ areas: ["a"] })], reg())).toHaveLength(1);
    expect(findRoleMetadataDrift([file({ areas: ["b", "a"] })], reg())).toHaveLength(1);
  });

  it("reports_to 漂移 ⇒ FAIL", () => {
    expect(findRoleMetadataDrift([file()], reg({ reports_to: "coord-other" }))).toHaveLength(1);
  });

  it("缺省与显式 null 等价——coord-main 在 registry 里没有 reports_to 键，role 文件写 null", () => {
    expect(findRoleMetadataDrift([file({ reports_to: null })], reg({ reports_to: null }))).toEqual([]);
  });

  it("三个字段都一致 ⇒ 零 finding（反向反证：永远红的门控等于没有）", () => {
    expect(findRoleMetadataDrift([file()], reg())).toEqual([]);
  });

  it("一次报出多条漂移，不在第一条就停", () => {
    expect(findRoleMetadataDrift([file()], reg({ kind: "coordinator", areas: ["x"] }))).toHaveLength(2);
  });

  it("未登记 / 无 name 的角色不在这里报——同一个缺口不许有两个严重度", () => {
    expect(findRoleMetadataDrift([file({ name: "unregistered" })], reg())).toEqual([]);
    expect(findRoleMetadataDrift([file({ name: null })], reg())).toEqual([]);
  });
});
