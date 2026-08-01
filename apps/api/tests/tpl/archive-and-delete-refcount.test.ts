import { describe, expect, it } from "vitest";
import { templates } from "@repo/contracts";
import {
  deleteButtonReplacedByArchive,
  evaluateArchiveGate,
  evaluateDeleteGate,
} from "../../src/domain/templates/archive-delete-gate";
import {
  canBindNewProject,
  canInstantiateExistingBinding,
  type BlueprintVersion,
} from "../../src/domain/templates/blueprint-version";

/**
 * F30 —— **删除引用计数门控 + 归档语义**（O-18 ① ③，`uc-2-4` R4 A1/A3 · R10 · V7b/V7c）。
 */

describe("V7b：不可删除——引用计数门控", () => {
  it("从未被套用（引用数 = 0）+ 已确认 ⇒ 允许删除", () => {
    const verdict = evaluateDeleteGate({ referencingProjectCount: 0 }, true);
    expect(verdict.allowed).toBe(true);
  });

  it("从未被套用但未确认 ⇒ NEEDS_CONFIRMATION，仍未放行", () => {
    const verdict = evaluateDeleteGate({ referencingProjectCount: 0 }, false);
    expect(verdict.allowed).toBe(false);
    expect(verdict).toMatchObject({ reason: "NEEDS_CONFIRMATION" });
  });

  it("已被 N 个项目套用 ⇒ 拒绝且指向 BLUEPRINT_IN_USE，detail 带 referencingProjectCount", () => {
    const verdict = evaluateDeleteGate({ referencingProjectCount: 5 }, true);
    expect(verdict.allowed).toBe(false);
    expect(verdict).toMatchObject({ reason: "BLUEPRINT_IN_USE", referencingProjectCount: 5 });
  });

  it("即使已确认，引用数 > 0 依然拒绝——没有 force/cascade 能绕过（判定顺序：先查引用）", () => {
    const verdict = evaluateDeleteGate({ referencingProjectCount: 1 }, true);
    expect(verdict.allowed).toBe(false);
    expect(verdict).toMatchObject({ reason: "BLUEPRINT_IN_USE" });
  });

  it("删除门的签名里没有 force / cascade / skipChecks 参数（V7b 逐字：不得存在可绕过判定的强制参数）", () => {
    expect(evaluateDeleteGate.length).toBe(2); // (counts, confirmed)
  });

  it("[× 删除] 按钮在引用数 > 0 时替换为 [归档]，阈值与删除门一致", () => {
    expect(deleteButtonReplacedByArchive(0)).toBe(false);
    expect(deleteButtonReplacedByArchive(1)).toBe(true);
    expect(deleteButtonReplacedByArchive(100)).toBe(true);
  });
});

describe("V7c：归档语义（O-18 ③ / 复用 O-10）——三件事分别成立", () => {
  const archivedV4: BlueprintVersion = {
    id: "ver-4",
    blueprintId: "bp-a",
    versionNumber: 4,
    content: { agendaSegments: ["s1"] },
    changedDesignFacetKeys: [],
    rolledBackFrom: null,
    state: "archived",
  };

  it("① 归档后禁止新增绑定——canBindNewProject 为 false", () => {
    expect(canBindNewProject(archivedV4)).toBe(false);
  });

  it("② 已用该版本的项目仍可正常运行——本身不依赖归档状态（存量绑定不受影响，无额外判定）", () => {
    // 「打开/编辑/运行正常」在领域层等价于「快照解析不因归档而失败」——
    // resolveBoundVersion（见 snapshot-binding.ts）不检查 state，归档版本依然可解析。
    expect(archivedV4.state).toBe("archived");
    expect(archivedV4.content).toEqual({ agendaSegments: ["s1"] });
  });

  it("③ 存量绑定仍可实例化画布/产出——canInstantiateExistingBinding 恒 true（防现场跑挂）", () => {
    expect(canInstantiateExistingBinding(archivedV4)).toBe(true);
  });

  it("对照：未归档（published）版本两者都应放行", () => {
    const published: BlueprintVersion = { ...archivedV4, state: "published" };
    expect(canBindNewProject(published)).toBe(true);
    expect(canInstantiateExistingBinding(published)).toBe(true);
  });

  it("归档需二次确认，确认框材料带 referencingProjectCount 与 referencingAgendaSegmentCount", () => {
    const counts = { referencingProjectCount: 3, referencingAgendaSegmentCount: 7 };
    const notConfirmed = evaluateArchiveGate(counts, false);
    expect(notConfirmed.allowed).toBe(false);
    expect(notConfirmed).toMatchObject({ reason: "NEEDS_CONFIRMATION", counts });

    const confirmed = evaluateArchiveGate(counts, true);
    expect(confirmed.allowed).toBe(true);
    expect(confirmed).toMatchObject({ counts });
  });

  it("归档门不看引用计数是否为零——0 引用也可归档（归档不是「没人用才归档」）", () => {
    const zero = evaluateArchiveGate({ referencingProjectCount: 0, referencingAgendaSegmentCount: 0 }, true);
    expect(zero.allowed).toBe(true);
  });
});

describe("契约对齐：错误码与本文件判定一一对应", () => {
  it("BLUEPRINT_IN_USE 与 NEEDS_CONFIRMATION 都是 deleteBlueprint 的失败面成员", () => {
    expect(templates.operations.deleteBlueprint.err).toContain("BLUEPRINT_IN_USE");
    expect(templates.operations.deleteBlueprint.err).toContain("NEEDS_CONFIRMATION");
  });

  it("deleteBlueprint 的入参里没有 force / cascade / skipChecks（V7b）", () => {
    const keys = Object.keys(templates.operations.deleteBlueprint.in.shape);
    expect(keys).toEqual(["blueprintId", "confirmed"]);
  });

  it("archiveBlueprint 的出参带 referencingProjectCount 与 referencingAgendaSegmentCount", () => {
    const keys = Object.keys(templates.operations.archiveBlueprint.out.shape);
    expect(keys).toEqual(
      expect.arrayContaining(["referencingProjectCount", "referencingAgendaSegmentCount"]),
    );
  });
});
