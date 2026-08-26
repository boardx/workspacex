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
import {
  buildDryRunSkeleton,
  parseDryRunInput,
  unknownKeysOf,
} from "../../components/canvas/template-dry-run-drawer";
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
