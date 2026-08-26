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

  /**
   * 人类 2026-08-26 截图实测：「对于 A1 的模板，需要 100% 全面覆盖，分配完，
   * 目前中间留了一些，不美观」。
   *
   * ⚠ 断言的是**逐格数出来的真实覆盖率**，不是"算法应该能填满"。填满由两道工序合成
   *   （压缩-摊开吃整行整列的空带，生长收零散边角），两道都**不保证** 100%——
   *   4 格宽的区块长不进只空 1 格的地方。所以这条必须是数格子，不是信算法。
   *   实测过程：只有压缩-摊开时 empathy/freytag 停在 70.8%、three-horizons 89.6%。
   */
  it("19 个模板每一个都 96/96 格全占满，一格不剩", () => {
    const under: string[] = [];
    for (const t of specs) {
      const filled = new Set<string>();
      for (const sec of buildBuiltinSections(t as never)) {
        const { col, row, w, h } = sec.layout;
        for (let c = col; c < col + w; c += 1) {
          for (let r = row; r < row + h; r += 1) filled.add(`${c},${r}`);
        }
      }
      if (filled.size !== 96) under.push(`${t.key}: ${filled.size}/96`);
    }
    expect(under).toEqual([]);
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
   * ⚠ 这条原先断言的是「中间第 5 行**空着**」——当时我判断那是原图本来就有的间隙，
   *   保留它才忠实。人类 2026-08-26 看到真实渲染后否掉了这个判断（「目前中间留了一些，
   *   不美观」），空带的份额还给了上面那一带（4 行）。断言跟着改，理由留在原处，
   *   不假装从来没那样想过。
   */
  it("6 个正文分区推成原图那样的 3 列 × 2 行，且铺满到底（第 1 行让给表头）", () => {
    const body = built.filter((s) => s.type === "便利贴列表");
    expect(body.map((s) => [s.name, s.key, s.layout.col, s.layout.row, s.layout.w, s.layout.h])).toEqual([
      ["用户描述", "description", 1, 2, 4, 4],
      ["目标和需求", "goals", 5, 2, 4, 4],
      ["行为与偏好", "behaviors", 9, 2, 4, 4],
      ["痛点和挑战", "pains", 1, 6, 4, 3],
      ["动机", "motivation", 5, 6, 4, 3],
      ["影响因素", "factors", 9, 6, 4, 3],
    ]);
    // 上下两带首尾相接（4 结束于第 5 行，痛点从第 6 行起）⇒ 中间没有空行。
    expect(Math.max(...body.map((s) => s.layout.row + s.layout.h - 1))).toBe(8);
    expect(body[0]!.layout.row + body[0]!.layout.h).toBe(body[3]!.layout.row);
  });

  it("表头字段是短文本、正文是便利贴列表——两者不混", () => {
    expect(built.filter((s) => s.type === "短文本").map((s) => s.name)).toEqual(persona.fields);
    expect(deriveKey("姓名", "field")).toBe("name");
    expect(deriveKey("姓名", "section")).toBe(null);
  });
});
