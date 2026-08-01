import { describe, expect, it } from "vitest";
import {
  CHANGE_KINDS,
  CLASSIFICATION_TABLE_ENTRIES,
  classifyChange,
  type ChangeClassification,
  type ChangeKind,
} from "../../src/domain/canvas/change-classification";
import { applyStructuralChange, type StructuralEdit } from "../../src/domain/canvas/conflict-resolution";

/**
 * F105 — `classifyChange` 判定表（O-32 / I-15）+ 结构性冲突「只在两侧同时改时产生」（I-16）。
 *
 * ## 这份测试在防什么
 *
 * `classifyChange` 是全函数：判定表七行必须逐行穷举，不能抽样几条——状态机/判定表类
 * 缺陷经常正好长在没被抽到的那一格里（同 F101 的教训）。本文件对七行逐条断言，
 * 并额外反证「表被悄悄删行」这件事本身会被测出来。
 *
 * O-32 最容易做反的一条：早期稿本把"便签换区（跨分区移动）"算成结构性改动
 * （因为它看起来改变了画布骨架），O-32 已按"改动作用的对象"重新裁定为 sticky-level。
 * 本文件把这一条单独列出来重点断言，而不是混在七行里一笔带过。
 *
 * I-16（单侧改结构直接同步、不弹冲突条）是 `applyStructuralChange` 产生 `conflictId`
 * 的唯一前提；本文件用「只有一侧提交」与「两侧都提交」两组反向对照来断言它。
 */
describe("F105 · classifyChange 判定表（七行全穷举，不抽样）", () => {
  const cases: ReadonlyArray<{ readonly kind: ChangeKind; readonly expect: ChangeClassification }> = [
    { kind: "sticky-text", expect: "sticky-level" },
    { kind: "sticky-color", expect: "sticky-level" },
    { kind: "sticky-position", expect: "sticky-level" },
    { kind: "sticky-section-move", expect: "sticky-level" },
    { kind: "section-add-remove-rename", expect: "structural" },
    { kind: "node-or-edge-structural", expect: "structural" },
    { kind: "template-version-or-diagram-type", expect: "structural" },
  ];

  for (const { kind, expect: exp } of cases) {
    it(`${kind} → ${exp}`, () => {
      const result = classifyChange({ instanceExists: true, kind });
      expect(result).toEqual({ ok: true, classification: exp });
    });
  }

  it("七行全部覆盖，一行不少（防止判定表被悄悄删行）", () => {
    expect(cases.map((c) => c.kind).sort()).toEqual([...CHANGE_KINDS].sort());
    expect(CLASSIFICATION_TABLE_ENTRIES).toHaveLength(7);
  });

  it("instanceExists=false 时返回 INSTANCE_NOT_FOUND，不做分类", () => {
    const result = classifyChange({ instanceExists: false, kind: "sticky-text" });
    expect(result).toEqual({ ok: false, reason: "INSTANCE_NOT_FOUND" });
  });

  it("未知 kind（契约层是开放字符串）保守地归入 structural，而不是抛异常或返回 undefined", () => {
    const result = classifyChange({ instanceExists: true, kind: "some-future-kind-nobody-registered-yet" });
    expect(result).toEqual({ ok: true, classification: "structural" });
  });

  describe("O-32 重点条款：便签跨分区移动归 sticky-level（早期稿本把它算错成 structural）", () => {
    it("sticky-section-move 不是 structural", () => {
      const result = classifyChange({ instanceExists: true, kind: "sticky-section-move" });
      expect(result.ok && result.classification).not.toBe("structural");
    });

    it("sticky-section-move 与其余三个便签级改动（文本/颜色/位置）分类一致", () => {
      const stickyKinds: ChangeKind[] = [
        "sticky-text", "sticky-color", "sticky-position", "sticky-section-move",
      ];
      const classifications = stickyKinds.map(
        (k) => classifyChange({ instanceExists: true, kind: k }),
      );
      for (const c of classifications) {
        expect(c).toEqual({ ok: true, classification: "sticky-level" });
      }
    });

    it("sticky-section-move 与结构性的三行（分区/节点连线/模板版本）分类不同", () => {
      const structuralKinds: ChangeKind[] = [
        "section-add-remove-rename", "node-or-edge-structural", "template-version-or-diagram-type",
      ];
      const sectionMove = classifyChange({ instanceExists: true, kind: "sticky-section-move" });
      for (const k of structuralKinds) {
        const other = classifyChange({ instanceExists: true, kind: k });
        expect(sectionMove).not.toEqual(other);
      }
    });
  });
});

describe("F105 · applyStructuralChange —— 只有两侧同时改才产生冲突（I-16）", () => {
  const docEdit: Omit<StructuralEdit, "side"> = {
    versionId: "v-doc-1", authorRef: "u-doc", at: "2026-08-01T10:00:00Z", summary: "文档侧新增一个分区",
  };
  const canvasEdit: Omit<StructuralEdit, "side"> = {
    versionId: "v-canvas-1", authorRef: "u-canvas", at: "2026-08-01T10:01:00Z", summary: "画布侧删除一个节点",
  };

  it("单侧改结构（另一侧无未同步改动）：直接同步，不产生 conflictId", () => {
    const result = applyStructuralChange({
      side: "doc",
      thisEdit: docEdit,
      pendingOtherSide: null,
      makeConflictId: () => "should-not-be-called",
    });
    expect(result).toEqual({ kind: "synced", versionId: "v-doc-1" });
  });

  it("单侧改了很多次、另一侧全程没动：每一次都直接同步（多次单侧改动不会累积成冲突）", () => {
    for (const versionId of ["v-doc-1", "v-doc-2", "v-doc-3"]) {
      const result = applyStructuralChange({
        side: "doc",
        thisEdit: { ...docEdit, versionId },
        pendingOtherSide: null,
        makeConflictId: () => "should-not-be-called",
      });
      expect(result).toEqual({ kind: "synced", versionId });
    }
  });

  it("两侧同时改（另一侧已有未同步的结构性改动）：产生 conflictId，两侧摘要都在", () => {
    const result = applyStructuralChange({
      side: "doc",
      thisEdit: docEdit,
      pendingOtherSide: { side: "canvas", ...canvasEdit },
      makeConflictId: () => "conflict-abc",
    });
    expect(result).toEqual({
      kind: "conflict",
      conflictId: "conflict-abc",
      docSide: { side: "doc", ...docEdit },
      canvasSide: { side: "canvas", ...canvasEdit },
    });
  });

  it("提交方是 canvas 侧时，docSide/canvasSide 仍按语义对号入座（不因提交顺序错位）", () => {
    const result = applyStructuralChange({
      side: "canvas",
      thisEdit: canvasEdit,
      pendingOtherSide: { side: "doc", ...docEdit },
      makeConflictId: () => "conflict-xyz",
    });
    expect(result.kind).toBe("conflict");
    if (result.kind === "conflict") {
      expect(result.docSide).toEqual({ side: "doc", ...docEdit });
      expect(result.canvasSide).toEqual({ side: "canvas", ...canvasEdit });
    }
  });
});
