/**
 * #608 遗留分歧的**现状锁** —— ⚠ 这个文件锁的是「今天是什么样」，**不是**「应该是什么样」。
 *
 * ## 分歧
 *
 * 「套用蓝本新建项目」**就是**新建项目，但两处判据从 2026-08-06 起不再一致：
 *   · `project` 束 `canCreateProject`  → `lead` **或 `admin`**（#608 人类裁决）
 *   · `templates` 束 `canApplyBlueprint` → **仍然只有 `lead`**
 *
 * #608 没有跟着改 `templates` 束，理由写在 `apply-blueprint.ts` 那个函数的头注里
 * （裁决只点名 `canCreateProject`；两束各自评审；且 `applyBlueprint` 尚未挂路由，
 * 当前用户不可达）。
 *
 * ## 为什么要给一个「已知是歪的」状态写测试
 *
 * 因为**不写它，这条分歧只活在一段注释里**，而注释不会红。本仓已经数次靠
 * 「同一事实两处声明」栽跟头，这次是明知有第二处却决定暂不动它——那就必须让
 * 「第二处还在老规矩上」这件事是**机械可见**的。
 *
 * ⇒ 谁来消除分歧（把 `canApplyBlueprint` 也放宽），本文件会红，红的消息里写着
 *   「请删掉本文件」。这是**故意的**：现状锁的寿命应当等于分歧的寿命。
 */
import { describe, expect, it } from "vitest";
import { identity as IdentityContract } from "@repo/contracts";
import { canApplyBlueprint } from "../../src/application/templates/apply-blueprint";
import { canCreateProject } from "../../src/domain/project/create-project-rules";

describe("#608 遗留分歧：templates 束的 canApplyBlueprint 仍只放行 lead", () => {
  it("两处判据对 `admin` 给出**不同**答案 —— 分歧仍在（消除它时本文件应被删除）", () => {
    expect(canCreateProject("admin")).toBe(true);
    expect(canApplyBlueprint("admin")).toBe(false);
  });

  it("`lead` 上两处仍然一致 —— 分歧只在 `admin` 这一格，不是整块判据走散了", () => {
    expect(canCreateProject("lead")).toBe(true);
    expect(canApplyBlueprint("lead")).toBe(true);
  });

  it("另两种角色两处都拒 —— 没有第三处走样", () => {
    for (const role of IdentityContract.OrgRole.options.filter((r) => r !== "lead" && r !== "admin")) {
      expect(canCreateProject(role), `canCreateProject(${role})`).toBe(false);
      expect(canApplyBlueprint(role), `canApplyBlueprint(${role})`).toBe(false);
    }
  });
});
