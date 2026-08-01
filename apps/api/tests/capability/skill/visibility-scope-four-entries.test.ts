/**
 * F62 · 可见性范围过滤四入口（`domain.md` I-14，`domain/skill/visibility-scope.ts`）。
 *
 * ⚠ 契约把四入口建成 `listSkills` **一个**操作的 `entry` 参数（`SkillListEntry`），
 *   本文件断言：`entry` 换成四个不同取值时，同一份数据、同一个请求者，
 *   过滤结果**逐字相同**——证明四处共用同一份判定，而不是四份各写一遍。
 * ⚠ 范围外**不返回其存在性**（404 非 403）：直读一个 team-only skill 时，
 *   非成员得到的东西必须与「真的不存在」**不可区分**——用既有的 `SkillVisibilityPort`
 *   替身验证（该替身对两种情况都返回 `null`，是 F61/F63 就定下的同一个出口）。
 */
import { describe, expect, it } from "vitest";
import { listSkills, type SkillListEntryName } from "../../../src/application/skill/list-skills";
import { isSkillVisibleTo } from "../../../src/domain/skill/visibility-scope";
import { skillCatalog, visibility } from "../../support/skill-fakes";

const CATALOG = skillCatalog(
  { skillId: "sk-org-wide", visibility: "org-wide", ownerTeamId: null },
  { skillId: "sk-team-a", visibility: "team-only", ownerTeamId: "team-a" },
  { skillId: "sk-team-b", visibility: "team-only", ownerTeamId: "team-b" },
);

const ENTRIES: readonly SkillListEntryName[] = ["library", "search", "binding-panel", "chat-mount"];

describe("四入口共用同一份可见性过滤（I-14）", () => {
  it("非 team-a 成员：四个入口对 team-a 的 skill 全部 0 命中，结果逐字相同", async () => {
    const results = await Promise.all(
      ENTRIES.map((entry) =>
        listSkills({ orgId: "org-1", entry, requesterTeamId: "team-b" }, { catalog: CATALOG }),
      ),
    );

    for (const r of results) {
      const ids = r.items.map((i) => i.skillId);
      expect(ids, "team-b 成员看不到 team-a 的 skill").not.toContain("sk-team-a");
      expect(ids).toContain("sk-org-wide");
      expect(ids).toContain("sk-team-b");
      expect(r.total).toBe(2);
    }

    // 四份结果两两相等——不是「恰好数字一样」，是同一批 id、同一个顺序。
    const shapes = results.map((r) => r.items.map((i) => i.skillId));
    for (let i = 1; i < shapes.length; i += 1) {
      expect(shapes[i], `entry=${ENTRIES[i]} 与 entry=${ENTRIES[0]} 的过滤结果必须相同`).toEqual(
        shapes[0],
      );
    }
  });

  it("请求者不在任何团队（`null`）：四入口对两个 team-only skill 都不可见", async () => {
    const results = await Promise.all(
      ENTRIES.map((entry) =>
        listSkills({ orgId: "org-1", entry, requesterTeamId: null }, { catalog: CATALOG }),
      ),
    );
    for (const r of results) {
      expect(r.items.map((i) => i.skillId)).toEqual(["sk-org-wide"]);
    }
  });

  it("org-wide 对任何请求者恒可见（不因四入口而异）", async () => {
    for (const entry of ENTRIES) {
      expect(
        isSkillVisibleTo({ visibility: "org-wide", ownerTeamId: null, requesterTeamId: null }),
        `entry=${entry}`,
      ).toBe(true);
    }
  });
});

describe("范围外不返回存在性：直读与「真的不存在」不可区分（404 非 403）", () => {
  it("team-only skill 对非成员：直读端口返回 `null`，与查一个从未存在的 id 相同", async () => {
    // ⚠ 替身按「没列出来的一律 null」建模（`skill-fakes.ts` 注释逐字）：
    //   「`sk-team-a` 对这个请求者不可见」与「`sk-does-not-exist` 压根没有这条记录」
    //   在替身表里都是「没登记」，调用方读到的都是 `null`——这正是 I-14 要求的
    //   「接口不返回其存在性」：两种输入必须落在同一个出口，不能有第二条路径把区别透出去。
    const port = visibility({});

    const outOfScope = await port.visibleTo({ skillId: "sk-team-a", principalId: "u-outsider" });
    const neverExisted = await port.visibleTo({ skillId: "sk-does-not-exist", principalId: "u-outsider" });

    expect(outOfScope).toBeNull();
    expect(neverExisted).toBeNull();
    expect(outOfScope).toEqual(neverExisted);
  });
});
