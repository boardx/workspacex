/**
 * `toDraft` 的 `type` 缺失兜底——回归 2026-08-30 人类实测的真实 bug（见
 * `template-editor-model.ts` 里 `toDraft` 的头注）：「chat 模拟」跑内置 `persona`
 * 模板，产出的表头（姓名/性别/年龄…）一片空白，根因是存量 DB 行缺 `type` 时
 * `toDraft` 无脑兜底成 `"便利贴列表"`，把表头字段错分类成正文分区，
 * `canvas-template-guidance.ts` 按 `type === "短文本"` 切分表头/正文时因此找不到
 * 任何表头字段，模型从未被告知要填姓名/性别/年龄这些值。
 *
 * 断言：`toDraft` 面对一行缺 `type` 的内置 `persona` 记录时，落在
 * `PERSONA_FIELDS`（姓名/性别/年龄/区域/教育水平/职位/行业/家庭情况/收入水平）里的
 * 分区名必须推成 `"短文本"`，其余（用户描述等正文分区）仍然是 `"便利贴列表"`——
 * 与非内置 key（或分区名对不上任何内置字段）时的原有兜底行为不变。
 */
import { describe, it, expect } from "vitest";
import { PERSONA_FIELDS, PERSONA_SECTIONS } from "@repo/fabric-markdown";
import { toDraft } from "../../components/canvas/template-editor-model";
import type { CanvasTemplate } from "../../lib/live-canvas";

function rowWithoutType(key: string, sectionNames: readonly string[]): CanvasTemplate {
  return {
    key,
    displayName: key,
    version: 1,
    status: "published",
    builtin: true,
    visibility: "org-wide",
    underlyingType: "canvas",
    sections: sectionNames.map((name, i) => ({
      sectionId: `sec-${i}`,
      name,
      order: i,
      required: false,
      capacity: null,
      layout: null,
    })),
    usageCount: 0,
    tags: [],
    title: "",
    footer: "",
    promptText: "",
    size: "A1",
  } as unknown as CanvasTemplate;
}

describe("toDraft 的 type 缺失兜底", () => {
  it("内置 persona 的表头字段名，缺 type 时推成 短文本，不是 便利贴列表", () => {
    const names = [...PERSONA_FIELDS, ...PERSONA_SECTIONS];
    const drafts = toDraft(rowWithoutType("persona", names));

    for (const field of PERSONA_FIELDS) {
      const d = drafts.find((x) => x.name === field);
      expect(d, `missing draft for ${field}`).toBeTruthy();
      expect(d!.type).toBe("短文本");
    }
    for (const section of PERSONA_SECTIONS) {
      const d = drafts.find((x) => x.name === section);
      expect(d, `missing draft for ${section}`).toBeTruthy();
      expect(d!.type).toBe("便利贴列表");
    }
  });

  it("非内置 key（或对不上任何内置字段名）时，缺 type 仍按原样兜底成 便利贴列表", () => {
    const drafts = toDraft(rowWithoutType("org-custom-key", ["随便起的分区名"]));
    expect(drafts[0]!.type).toBe("便利贴列表");
  });
});
