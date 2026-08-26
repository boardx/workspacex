/**
 * 内置模板配置**推演**的门控（人类 2026-08-26：「所有的不同阶段的数据都可以查看和修改」）。
 *
 * ## 这份测试挡的是什么
 *
 * 推演是纯算术 + 一张中文名字典，两者都可能悄悄失效：
 *
 * · **字典漏词** ⇒ 那个分区没有 `key` ⇒ AI 输出的 JSON 对不上任何分区 ⇒ 画布上空一块。
 *   漏词不会报错，只会少一个字段，所以必须机械地对**全量 114 个分区名**断言覆盖。
 * · **坐标撞车** ⇒ 两个分区叠在同一格 ⇒ 编辑器里后放的那个盖住前一个。开发时确实撞过
 *   8 处（bmc/ai-strategy/ai-bmc 各因舍入粘连，journey-map 因超出基准画幅被夹成同一行），
 *   而这两类都**在渲染出来之前完全看不见**。
 *
 * ⚠ 本文件断言的是 `listTemplates()` 的**真实 spec**，不是夹具。夹具会随着断言一起被改，
 *   而真实 spec 变了就该在这里红——那正是要它红的时候。
 */
import { describe, it, expect } from "vitest";
import { listTemplates } from "@repo/fabric-markdown/templates";
import {
  deriveTemplateLayouts,
  deriveKey,
  keyDictionaryCoverage,
  buildBuiltinSections,
} from "../../src/domain/canvas/builtin-template-config";

const specs = listTemplates();

describe("内置模板配置推演", () => {
  it("19 个模板全部推得出来", () => {
    expect(specs.length).toBe(19);
  });

  it("全部分区名都能映成 AI JSON 键名（字典零漏词）", () => {
    const names = specs.flatMap((t) => t.sections.map((s) => s.name));
    const { missing } = keyDictionaryCoverage(names, "section");
    expect(missing).toEqual([]);
  });

  it("全部表头字段名都能映成 AI JSON 键名", () => {
    const names = specs.flatMap((t) => (t.fields ?? []) as readonly string[]);
    const { missing } = keyDictionaryCoverage(names, "field");
    expect(missing).toEqual([]);
  });

  it("每个模板的网格坐标都不越界", () => {
    for (const t of specs) {
      for (const l of deriveTemplateLayouts(t.sections)) {
        expect(l.col, t.key).toBeGreaterThanOrEqual(1);
        expect(l.row, t.key).toBeGreaterThanOrEqual(1);
        expect(l.col + l.w - 1, t.key).toBeLessThanOrEqual(12);
        expect(l.row + l.h - 1, t.key).toBeLessThanOrEqual(8);
      }
    }
  });

  it("同一个模板内**没有任何两个分区叠在同一格**", () => {
    const overlaps: string[] = [];
    for (const t of specs) {
      // 表头字段占第 1 行、正文下移一行——按最终落库的那份判，不是按半成品判。
      const built = buildBuiltinSections(t as never);
      const grid = new Map<string, string>();
      for (const sec of built) {
        const { col, row, w, h } = sec.layout;
        for (let c = col; c < col + w; c += 1) {
          for (let r = row; r < row + h; r += 1) {
            const cell = `${c},${r}`;
            const taken = grid.get(cell);
            if (taken !== undefined) overlaps.push(`${t.key}: ${taken} × ${sec.name} @ ${cell}`);
            else grid.set(cell, sec.name);
          }
        }
      }
    }
    expect(overlaps).toEqual([]);
  });

  it("推演是确定性的——同一份 spec 推两次结果逐字相同", () => {
    for (const t of specs) {
      expect(buildBuiltinSections(t as never)).toEqual(buildBuiltinSections(t as never));
    }
  });
});

describe("用户画像（人类点名的那一个）", () => {
  const persona = specs.find((t) => t.key === "persona")!;
  const built = buildBuiltinSections(persona as never);

  it("9 个表头字段铺满第 1 行、无缝无空格", () => {
    const header = built.filter((s) => s.type === "短文本");
    expect(header.length).toBe(9);
    expect(header.every((s) => s.layout.row === 1 && s.layout.h === 1)).toBe(true);
    // 首列 1、末列 12、且逐个首尾相接 ⇒ 整行既不重叠也不留缝。
    expect(header[0]!.layout.col).toBe(1);
    const last = header[header.length - 1]!.layout;
    expect(last.col + last.w - 1).toBe(12);
    for (let i = 1; i < header.length; i += 1) {
      const prev = header[i - 1]!.layout;
      expect(header[i]!.layout.col).toBe(prev.col + prev.w);
    }
  });

  /**
   * ⚠ 上下两带的高度是 4 与 3，不是 4 与 4——第 1 行让给了 9 个表头字段，正文只剩 7 行，
   *   两带**不可能**均分。这不是舍入误差：把它写成 4/4 会溢出到第 9 行（网格只有 8 行）。
   *   原图那种"两带等高"在带表头的模板里本来就做不到，如实推成 4/3 而不是硬凑。
   */
  it("6 个正文分区推成原图那样的 3 列 × 2 行（第 1 行让给表头）", () => {
    const body = built.filter((s) => s.type === "便利贴列表");
    expect(body.map((s) => [s.name, s.key, s.layout.col, s.layout.row, s.layout.w, s.layout.h])).toEqual([
      ["用户描述", "description", 1, 2, 4, 4],
      ["目标和需求", "goals", 5, 2, 4, 4],
      ["行为与偏好", "behaviors", 9, 2, 4, 4],
      ["痛点和挑战", "pains", 1, 6, 4, 3],
      ["动机", "motivation", 5, 6, 4, 3],
      ["影响因素", "factors", 9, 6, 4, 3],
    ]);
    // 三列并排、两带相接、末行贴到网格底 ⇒ 整张 A1 铺满，没有留白也没有溢出。
    expect(Math.max(...body.map((s) => s.layout.row + s.layout.h - 1))).toBe(8);
  });

  it("表头字段是短文本、正文是便利贴列表——两者不混", () => {
    expect(built.filter((s) => s.type === "短文本").map((s) => s.name)).toEqual(persona.fields);
    expect(deriveKey("姓名", "field")).toBe("name");
    expect(deriveKey("姓名", "section")).toBe(null);
  });
});
