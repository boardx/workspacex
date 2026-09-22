/**
 * feature 模板 / TS 类型 / 校验器的**同源反证**（issue #386）。
 *
 * 这三份东西曾各自声明一遍 feature 的字段集，并且已经真的漂移了：
 *   · 模板 `.harness/templates/feature_list.template.json` 缺 `spec_ref`/`depends_on`/`points`
 *   · `lib/types.ts` 的 `interface Feature` 缺 `points`
 *   · `validate-fl.ts` 自建第三份 interface，字段集与上面两份都不同
 * 收敛后三者全部派生自 `lib/feature-schema.ts` 的 `FEATURE_FIELDS`。
 *
 * 本套件要证的不是「今天它们一致」——那种断言在字段表被改动时会跟着一起变绿，
 * 等于什么都没守。要证的是**「任一份再漂移，这里必须红」**，所以每条判定都配一条
 * 注入漂移的反证：喂进去一份漂移的模板/缺字段的 feature/复活的第二份 interface，
 * 断言判红，并点名是哪个字段。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FEATURE_FIELDS,
  FEATURE_FIELD_NAMES,
  FEATURE_STATES,
  checkFeatureFields,
  checkFeatureListTemplate,
  fieldSpec,
  renderFeatureListTemplate,
  templateFeature,
  type Feature,
} from "./lib/feature-schema";

const ROOT = join(__dirname, "..", "..");
const TEMPLATE_PATH = join(ROOT, ".harness", "templates", "feature_list.template.json");
const TEMPLATE_TEXT = readFileSync(TEMPLATE_PATH, "utf8");

/** 漂移前那份模板的字段集——正是 #386 记录的现场：三个字段不在里面。 */
const DRIFTED_TEMPLATE = JSON.stringify(
  {
    phase: "{{PHASE_ID}}",
    features: [
      {
        id: "F01",
        priority: 1,
        area: "orchestrator",
        title: "示例",
        user_visible_behavior: "…",
        status: "not_started",
        sprint: null,
        owner: null,
        capability: "CAP-WEB",
        verification: ["true"],
        evidence: "",
        notes: "",
      },
    ],
  },
  null,
  2,
) + "\n";

describe("① 模板是字段表的生成物", () => {
  it("磁盘上的模板今天与字段表逐字相同", () => {
    expect(checkFeatureListTemplate(TEMPLATE_TEXT)).toMatchObject({ ok: true, problems: [] });
  });

  it("反证：漂移前那份模板（缺 spec_ref/depends_on/points）必须判红并逐个点名", () => {
    const r = checkFeatureListTemplate(DRIFTED_TEMPLATE);
    expect(r.ok).toBe(false);
    for (const missing of ["spec_ref", "depends_on", "points"]) {
      expect(r.problems.join("\n")).toContain(`模板缺字段 ${missing}`);
    }
  });

  it("反证：字段集齐了但值被改坏（points: 3 → 0）也必须判红——只比字段集会漏掉这种", () => {
    const tampered = renderFeatureListTemplate().replace('"points": 3', '"points": 0');
    expect(tampered).not.toBe(renderFeatureListTemplate()); // 确认这次注入真的改到了东西
    const r = checkFeatureListTemplate(tampered);
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toContain("不逐字相同");
  });

  it("反证：模板多出一个字段表里没有的字段 ⇒ 红", () => {
    const extra = renderFeatureListTemplate().replace('"id": "F01",', '"id": "F01",\n      "legacy_flag": true,');
    const r = checkFeatureListTemplate(extra);
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toContain("模板多出字段 legacy_flag");
  });

  it("空集防线：读不到 / 不是 JSON / 没有示例 feature，都要判红而不是平凡为真", () => {
    expect(checkFeatureListTemplate(null).ok).toBe(false);
    expect(checkFeatureListTemplate("{ 不是 JSON").ok).toBe(false);
    expect(checkFeatureListTemplate(JSON.stringify({ phase: "{{PHASE_ID}}", features: [] })).ok).toBe(false);
  });
});

describe("② 校验器按字段表判，不自带第二份字段集", () => {
  it("模板里那条示例 feature 自己必须是合法的 —— 否则脚手架一出生就是坏的", () => {
    expect(checkFeatureFields(templateFeature())).toEqual([]);
  });

  it("反证：逐个删掉每一个必填字段，校验器都必须红并点名该字段", () => {
    const required = FEATURE_FIELD_NAMES.filter((n) => FEATURE_FIELDS[n].required);
    expect(required.length).toBeGreaterThan(0); // 空集防线：没有必填字段 = 这条测试什么都没测
    for (const name of required) {
      const broken = templateFeature();
      delete broken[name];
      const problems = checkFeatureFields(broken);
      expect(problems.join("\n"), `删掉必填字段 ${name} 后校验器没红`).toContain(`缺必填字段 ${name}`);
    }
  });

  it("反证：逐个把每个字段的值换成错类型，校验器都必须红并点名该字段", () => {
    // 每种 kind 配一个**肯定不合法**的值：字符串字段塞数字、数字字段塞字符串、
    // 数组字段塞字符串、状态字段塞一个不在取值域里的串。
    const wrong = { string: 42, number: "42", "string[]": "F02", status: "done" } as const;
    for (const name of FEATURE_FIELD_NAMES) {
      const broken: Record<string, unknown> = templateFeature();
      broken[name] = wrong[FEATURE_FIELDS[name].kind];
      const problems = checkFeatureFields(broken);
      expect(problems.join("\n"), `字段 ${name} 被塞了错类型的值，校验器没红`).toContain(name);
    }
  });

  it("反证：可空字段与不可空字段对 null 的判定相反", () => {
    const nullable = FEATURE_FIELD_NAMES.filter((n) => fieldSpec(n).nullable);
    const notNullable = FEATURE_FIELD_NAMES.filter((n) => !fieldSpec(n).nullable);
    expect(nullable).toContain("owner"); // 未认领 = null，与"没有 owner 这个 key"不是一回事
    for (const name of nullable) {
      expect(checkFeatureFields({ ...templateFeature(), [name]: null })).toEqual([]);
    }
    for (const name of notNullable) {
      expect(checkFeatureFields({ ...templateFeature(), [name]: null }).join("\n")).toContain(`${name} 不允许为 null`);
    }
  });

  it("points 的下界、非空约束、状态取值域都由字段表说了算", () => {
    expect(checkFeatureFields({ ...templateFeature(), points: 0 }).join("\n")).toContain("小于下界 1");
    expect(checkFeatureFields({ ...templateFeature(), title: "   " }).join("\n")).toContain("title 不得为空");
    expect(checkFeatureFields({ ...templateFeature(), verification: [] }).join("\n")).toContain("verification 不得为空数组");
    expect(checkFeatureFields({ ...templateFeature(), status: "done" }).join("\n")).toContain(FEATURE_STATES.join(" / "));
    expect(checkFeatureFields("不是对象")).toEqual(["不是一个对象"]);
  });

  it("#386 现场回归：三个漂移字段今天必须都在字段表里", () => {
    // 这不是"重复声明字段集"，是把 issue 记录的那次具体漂移钉成回归锚点：
    // 谁把 spec_ref / depends_on / points 从字段表里删掉，这里立刻红。
    for (const name of ["spec_ref", "depends_on", "points"]) {
      expect(FEATURE_FIELD_NAMES).toContain(name);
    }
  });
});

describe("③ TS 类型是字段表派生的，不许再手写第二份", () => {
  // 编译期断言：模板示例必须**是**一个合法 Feature。字段表加了必填字段而 sample 没跟上，
  // 或者 sample 的类型与字段表对不上，`pnpm exec tsc --noEmit` 当场红。
  it("模板示例在类型上就是一个 Feature（编译期判定，运行时只是走个过场）", () => {
    const sample = templateFeature() as unknown as Feature;
    expect(sample.id).toBe(FEATURE_FIELDS.id.sample);
    expect(sample.points).toBe(FEATURE_FIELDS.points.sample);
    expect(sample.spec_ref).toBe(FEATURE_FIELDS.spec_ref.sample);
  });

  it("反证：读 feature 的脚本里不许再出现手写的 feature 字段声明", () => {
    // verify-uc-coverage.ts 曾是第**四**份（`interface Feature { id; spec_ref?; points? }`）——
    // 同一事实第四次声明，同样收敛。
    for (const rel of [
      ".harness/scripts/lib/types.ts",
      ".harness/scripts/validate-fl.ts",
      ".harness/scripts/verify-uc-coverage.ts",
    ]) {
      expect(declaresOwnFeatureShape(readFileSync(join(ROOT, rel), "utf8")), `${rel} 又自建了一份 feature 字段声明`).toBe(
        false,
      );
    }
  });

  it("空集防线：判据本身抓得住——喂一份复活的 interface 必须判 true", () => {
    expect(declaresOwnFeatureShape("interface Feature {\n  id: string;\n}")).toBe(true);
    expect(declaresOwnFeatureShape("type Feature = { id: string }")).toBe(true);
    expect(declaresOwnFeatureShape('import type { Feature } from "./feature-schema";')).toBe(false);
  });
});

/** 源码里是否又出现了一份手写的 `Feature` 形状声明（再导出/导入不算）。 */
function declaresOwnFeatureShape(source: string): boolean {
  return /(?:^|\n)\s*(?:export\s+)?(?:interface\s+Feature\s*\{|type\s+Feature\s*=\s*\{)/.test(source);
}
