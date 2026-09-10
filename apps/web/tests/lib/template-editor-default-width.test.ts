/**
 * 新放到画布上的区块默认占多宽——用户直接交办（2026-09-10）：
 * 「现在默认 text 的长度是 6，改为默认是 2」。
 *
 * 「短文本」渲染出来是表头带里的一个 `标签: 值` 字段（`buildExplicitTemplateSpec`
 * 的 `headerCells`），一个字段默认占掉半张纸宽既填不满也挡别人；半幅那个默认是
 * 给便利贴列表那种成片贴纸的分区准备的。这里钉住两者从此不共用一个默认值。
 */
import { describe, expect, it } from "vitest";
import { defaultLayoutAt } from "@/components/canvas/template-editor-model";

describe("defaultLayoutAt —— 落到画布上的默认宽度", () => {
  it("12 列制：短文本默认 2 格，其余类型仍是半幅 6 格", () => {
    expect(defaultLayoutAt("短文本", 1, 1, 12).w).toBe(2);
    expect(defaultLayoutAt("便利贴列表", 1, 1, 12).w).toBe(6);
    expect(defaultLayoutAt("文本对象", 1, 1, 12).w).toBe(6);
  });

  it("6 列制：同一条比例，短文本 1 格、其余 3 格", () => {
    expect(defaultLayoutAt("短文本", 1, 1, 6).w).toBe(1);
    expect(defaultLayoutAt("便利贴列表", 1, 1, 6).w).toBe(3);
  });

  /**
   * ⚠ 独立 review 抓到（2026-09-10）：默认宽度此前写成 `gridCols === 12 ? a : b`，
   * 24 列制会落进 6 列制那一支、拿到该有宽度的四分之一。改成按比例算之后，
   * 每一档都是同一条规则的应用，不必每加一档补一个分支。
   */
  it("24 列制：短文本 4 格、其余 12 格——与 12 列制是同一条比例，不是落进 6 列那一支", () => {
    expect(defaultLayoutAt("短文本", 1, 1, 24).w).toBe(4);
    expect(defaultLayoutAt("便利贴列表", 1, 1, 24).w).toBe(12);
  });

  it("靠右边落点仍夹回画布内，不因为默认值变小就绕过夹取", () => {
    // 12 列制、落在第 12 列：只剩 1 格，两种类型都被夹到 1。
    expect(defaultLayoutAt("短文本", 12, 1, 12).w).toBe(1);
    expect(defaultLayoutAt("便利贴列表", 12, 1, 12).w).toBe(1);
  });
});
