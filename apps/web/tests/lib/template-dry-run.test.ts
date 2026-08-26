/**
 * 试运行的判定逻辑（人类 2026-08-26：「用户输入数据需要可以渲染出来结果」）。
 *
 * ## 这里挡的三种**无声**失败
 *
 * 试运行本身是给人看的，但它有三处会"看起来正常、其实没生效"：
 *
 * 1. **多余的键**——数据里有、模板里没有。不报错，那段内容就是不出现。人类看到的是
 *    「我明明填了却没显示」，而画布上没有任何线索指向真正的原因。
 * 2. **顶层不是对象**——`[...]` 或 `"abc"` 都是合法 JSON。放行的话画布全空，
 *    与"数据里所有字段都对不上"完全同形。
 * 3. **骨架被缓存**——人类改完 key 之后「填充示例」还吐旧键名，那份 JSON 看起来
 *    完全正常，只是渲染出来永远是空贴纸。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDryRunSkeleton,
  parseDryRunInput,
  unknownKeysOf,
} from "../../components/canvas/template-dry-run-drawer";
import { visibleNoteCount } from "../../components/canvas/template-canvas-grid";
import type { SectionDraft } from "../../components/canvas/template-editor-model";

function draft(over: Partial<SectionDraft>): SectionDraft {
  return {
    sectionId: "s1", name: "分区", key: "sec", type: "便利贴列表",
    required: false, capacity: null, aiHint: "", order: 0,
    layout: { col: 1, row: 1, w: 4, h: 4, cols: 3, max: 6, tone: 0, overflow: "缩小字号" },
    ...over,
  } as SectionDraft;
}

describe("parseDryRunInput", () => {
  it("合法对象通过", () => {
    const r = parseDryRunInput('{"a": ["x"]}');
    expect(r.ok && r.data).toEqual({ a: ["x"] });
  });

  it("空输入不当成错误 JSON，而是说「还没输入」", () => {
    const r = parseDryRunInput("   ");
    expect(r).toEqual({ ok: false, message: "还没有输入数据" });
  });

  it("非法 JSON 带上解析器自己的原因", () => {
    const r = parseDryRunInput("{oops");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message.startsWith("不是合法的 JSON：")).toBe(true);
  });

  it.each([["[1,2]", "数组"], ['"abc"', "裸字符串"], ["null", "null"]])(
    "顶层是 %s（%s）当场拒绝，不放行成一张空画布",
    (text) => {
      const r = parseDryRunInput(text);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.message).toContain("顶层要是一个对象");
    },
  );
});

describe("unknownKeysOf", () => {
  const sections = [draft({ key: "pains" }), draft({ sectionId: "s2", key: "goals" })];

  it("点出数据里有、模板里没有的键", () => {
    expect(unknownKeysOf({ pains: [], goals: [], nope: [] }, sections)).toEqual(["nope"]);
  });

  it("全都对得上时不报警", () => {
    expect(unknownKeysOf({ pains: [] }, sections)).toEqual([]);
  });

  it("没填 key 的分区不会把任何东西「认领」走", () => {
    // 空 key 若被当成一个合法键名，`{"": ...}` 就会被判成"模板里有"——
    // 而画布上它永远渲染不出来。
    expect(unknownKeysOf({ "": [] }, [draft({ key: "" })])).toEqual([""]);
  });
});

describe("buildDryRunSkeleton", () => {
  it("列表分区给数组、文本分区给字符串——形状就是运行时 AI 要吐的那个", () => {
    const json = JSON.parse(
      buildDryRunSkeleton([
        draft({ key: "pains", name: "痛点", type: "便利贴列表" }),
        draft({ sectionId: "s2", key: "desc", name: "描述", type: "长文本" }),
      ]),
    );
    expect(Array.isArray(json.pains)).toBe(true);
    expect(typeof json.desc).toBe("string");
  });

  it("没填 key 的分区不进骨架（`{undefined: ...}` 不是数据，是垃圾）", () => {
    expect(JSON.parse(buildDryRunSkeleton([draft({ key: "" })]))).toEqual({});
  });

  it("条数不超过该分区的「最多条数」", () => {
    const json = JSON.parse(
      buildDryRunSkeleton([
        draft({ key: "k", layout: { col: 1, row: 1, w: 4, h: 4, cols: 3, max: 2, tone: 0, overflow: "缩小字号" } }),
      ]),
    );
    expect(json.k.length).toBe(2);
  });

  /** 反证第 3 种无声失败：骨架必须跟着当前 sections 走，不能是一份缓存。 */
  it("改了 key 之后重新生成的骨架用新键名", () => {
    const before = JSON.parse(buildDryRunSkeleton([draft({ key: "old" })]));
    const after = JSON.parse(buildDryRunSkeleton([draft({ key: "new" })]));
    expect(Object.keys(before)).toEqual(["old"]);
    expect(Object.keys(after)).toEqual(["new"]);
  });
});

/**
 * 试运行到底渲不渲染得出来 —— 2026-08-26 CI `fullstack-smoke` 实测红：区块能找到，
 * 但里面**没有**填进去的文字。
 *
 * ## 根因：`noteCount` 会被容量夹成 0
 *
 * ```ts
 * const capacity = Math.min(layout.max, Math.max(0, geom.fits));
 * const noteCount = Math.min(capacity, Math.max(1, values.length));
 * ```
 *
 * `geom.fits` 是「这块地方物理上放得下几张贴纸」。区块小到放不下**一张**时 `fits === 0`
 * ⇒ `capacity === 0` ⇒ `noteCount === 0` ⇒ **一张贴纸都不渲染**，人类填的数据凭空消失。
 *
 * ⚠ 这不是"装不下所以少画几张"，是"装不下所以一张都不画"——而画布上那个区块**还在**，
 *   只是空的。看起来像"试运行按钮没反应"，而真正的原因在两层之外的几何计算里。
 *
 * ⚠ 修法不是把 `fits` 调大（那是在骗人：地方确实不够），而是**至少画一张**并如实标红
 *   「装不下」。一张画不出来的预览没有任何信息量；一张画出来了、旁边写着装不下的
 *   预览，才回答了试运行要回答的那个问题。
 */
describe("noteCount：地方再小也要画出至少一张，否则数据凭空消失", () => {
  it("容量为 0 时仍渲染 1 张（而不是 0 张）", () => {
    expect(visibleNoteCount(0, 3)).toBe(1);
  });

  it("容量够用时按数据条数画", () => {
    expect(visibleNoteCount(6, 3)).toBe(3);
  });

  it("数据比容量多时画到容量为止（多出来的由「装不下」提示交代）", () => {
    expect(visibleNoteCount(2, 5)).toBe(2);
  });

  it("没有试运行数据时用容量（样例数据模式的既有行为不受影响）", () => {
    expect(visibleNoteCount(4, null)).toBe(4);
  });
});

/**
 * 纸面三带的**显式占行** —— 2026-08-26 CI 实测事故的结构反证。
 *
 * ## 事故经过
 *
 * 纸面是 `gridTemplateRows: "auto 1fr auto"`（标题带 / 内容 / 页脚带）。标题为空时那一带
 * **不渲染**，于是内容区成了第一个子元素、被隐式排进第 1 行（`auto`）——高度从 `1fr`
 * 变成"内容高"，塌成几乎为 0。
 *
 * `cellFrom` 用内容区的 rect 算落点比例：`r.height ≈ 0` ⇒ `ratioY` 远大于 1 ⇒ 行号被夹到
 * 第 8 行 ⇒ 那一行 `geom.fits === 0` ⇒ 拖进去的区块一张贴纸都画不出来。
 * 症状是「试运行点了没反应」，而根因在三层之外的 CSS 隐式网格排布里。
 *
 * ⚠ 这类缺陷 **jsdom 测不出来**：那里 `getBoundingClientRect()` 一律返回 0，塌不塌都一样。
 *   所以这里退一步，断言**结构不变量**（三个子元素各自显式声明 `gridRow`），
 *   而不是断言渲染结果。它挡不住"占错行"，但挡得住"不声明、靠出现顺序"——
 *   而后者正是出事的那一种。真实几何由 e2e 在真浏览器里证。
 */
describe("纸面三带必须显式占行，不靠出现顺序", () => {
  const SOURCE = readFileSync(
    join(__dirname, "../../components/canvas/template-canvas-grid.tsx"),
    "utf8",
  );

  it("三行都被显式声明了（1 = 标题带、2 = 内容、3 = 页脚带）", () => {
    expect(SOURCE).toContain("gridRow: 1,");
    expect(SOURCE).toContain("gridRow: 2,");
    expect(SOURCE).toContain("gridRow: 3,");
  });

  it("落点换算的基准是内容区，不是整张纸", () => {
    // ⚠ 用整张纸的 rect 会让落点整体偏移，且**有没有标题**会让偏移量变化——
    //   那种错位看起来像"拖拽不准"，查不到原因。
    expect(SOURCE).toContain("const el = contentRef.current;");
    expect(SOURCE).not.toContain("const el = paperRef.current;");
  });
});
