// 探针自身的单测。
//
// 为什么探针需要单测：探针是用来证明"门不是空转"的工具，如果探针本身空转，
// 它会给出比没有探针更糟的结果——一份看起来全绿的假证据。本文件的每条用例都
// 对应一次真实跑过的反证（2026-08-18，见 #1573 的 PR 正文）：
//   反证 A：把 graph-authority 弄成永远 exit 0 → 探针报 MISSED   ✓
//   反证 B：变异指向不存在的字段              → 探针报 INEFFECTIVE ✓
//   反证 C：guards 判无数据                  → 探针报 NO_DATA    ✓
// 单测把这三条的**判定逻辑**钉死，避免以后重构时静默退化成"永远绿"。
import { describe, expect, it } from "vitest";
import {
  GATE_SPECS,
  appendLine,
  blankField,
  dropField,
  dropFirstIndentedField,
  duplicateEntryId,
  probePassed,
  setField,
  summarize,
  trackNewFile,
  type MutationIo,
  type ProbeReport,
} from "./gate-mutation-spec";

function fakeIo(files: Record<string, string>): MutationIo & { added: string[] } {
  const added: string[] = [];
  return {
    added,
    read: (rel) => files[rel] ?? "",
    write: (rel, c) => {
      files[rel] = c;
    },
    exists: (rel) => rel in files,
    gitAdd: (rel) => void added.push(rel),
  };
}

describe("变异原语：改不动时必须返回 false（否则会把探针自身的故障误报成门漏过）", () => {
  it("blankField 字段不存在 → false", () => {
    expect(blankField("a.yaml", "nope")("/", fakeIo({ "a.yaml": "k: v\n" }))).toBe(false);
  });
  it("blankField 文件不存在 → false", () => {
    expect(blankField("missing.yaml", "k")("/", fakeIo({}))).toBe(false);
  });
  it("dropField 字段不存在 → false", () => {
    expect(dropField("a.yaml", "nope")("/", fakeIo({ "a.yaml": "k: v\n" }))).toBe(false);
  });
  it("setField 字段不存在 → false", () => {
    expect(setField("a.yaml", "nope", "x")("/", fakeIo({ "a.yaml": "k: v\n" }))).toBe(false);
  });
  it("dropFirstIndentedField 无缩进字段 → false", () => {
    expect(dropFirstIndentedField("a.yaml", "owner")("/", fakeIo({ "a.yaml": "owner: v\n" }))).toBe(
      false,
    );
  });
  it("duplicateEntryId 找不到源条目 → false", () => {
    expect(duplicateEntryId("a.yaml", "id", "X", "Y")("/", fakeIo({ "a.yaml": "- id: Z\n" }))).toBe(
      false,
    );
  });
  it("appendLine 文件不存在 → false", () => {
    expect(appendLine("missing.md", "x")("/", fakeIo({}))).toBe(false);
  });
});

describe("变异原语：改得动时必须真的改到东西", () => {
  it("blankField 清空值", () => {
    const f = { "a.yaml": "k: v\nother: z\n" };
    expect(blankField("a.yaml", "k")("/", fakeIo(f))).toBe(true);
    expect(f["a.yaml"]).toContain("k:\n");
    expect(f["a.yaml"]).toContain("other: z");
  });
  it("setField 换值", () => {
    const f = { "a.yaml": "kind: progress\n" };
    setField("a.yaml", "kind", "bogus")("/", fakeIo(f));
    expect(f["a.yaml"]).toContain("kind: bogus");
  });
  it("dropField 删行", () => {
    const f = { "a.yaml": "k: v\ndrop: me\n" };
    dropField("a.yaml", "drop")("/", fakeIo(f));
    expect(f["a.yaml"]).not.toContain("drop");
  });
  it("dropFirstIndentedField 只删第一处", () => {
    const f = { "a.yaml": "x:\n  owner: a\ny:\n  owner: b\n" };
    dropFirstIndentedField("a.yaml", "owner")("/", fakeIo(f));
    expect(f["a.yaml"].match(/owner:/g)).toHaveLength(1);
  });
  it("duplicateEntryId 制造出重复 id", () => {
    const f = { "a.yaml": "- id: A\n  v: 1\n- id: B\n  v: 2\n" };
    expect(duplicateEntryId("a.yaml", "id", "B", "A")("/", fakeIo(f))).toBe(true);
    expect(f["a.yaml"].match(/id: A/g)!.length).toBeGreaterThanOrEqual(2);
  });
  it("trackNewFile 会写文件并调 gitAdd", () => {
    const io = fakeIo({});
    expect(trackNewFile("p/x.yaml", "x: 1")("/", io)).toBe(true);
    expect(io.added).toEqual(["p/x.yaml"]);
  });
});

describe("probePassed：判定语义", () => {
  const r = (o: ProbeReport["outcomes"]): ProbeReport => ({ baselineFailures: [], outcomes: o });
  const oc = (verdict: ProbeReport["outcomes"][number]["verdict"]) => ({
    gate: "g",
    mutation: "m",
    verdict,
    exitCode: null,
  });

  it("全 CAUGHT → 通过", () => expect(probePassed(r([oc("CAUGHT")]))).toBe(true));
  it("有 MISSED → 不通过（门漏了）", () =>
    expect(probePassed(r([oc("CAUGHT"), oc("MISSED")]))).toBe(false));
  it("有 INEFFECTIVE → 不通过（探针自己坏了，比门漏更危险，因为它伪装成通过）", () =>
    expect(probePassed(r([oc("INEFFECTIVE")]))).toBe(false));
  it("NO_DATA 不判失败——「门守着空数据」是要报出来的事实，不是要拦 CI 的错误", () =>
    expect(probePassed(r([oc("NO_DATA")]))).toBe(true));
  it("基线红 → 不通过（干净树上就红，变异反证无从谈起）", () =>
    expect(probePassed({ baselineFailures: [{ gate: "g", exitCode: 1 }], outcomes: [] })).toBe(
      false,
    ));
  it("全 NO_DATA 时 CAUGHT 为 0——调用方必须据此避免打印「全部捕获」的谎报", () => {
    const rep = r([oc("NO_DATA"), oc("NO_DATA")]);
    expect(probePassed(rep)).toBe(true);
    expect(summarize(rep).CAUGHT).toBe(0);
  });
});

describe("登记表", () => {
  it("每道门至少一条变异——没有变异反证的门等于没有证据说它在工作", () => {
    for (const s of GATE_SPECS) expect(s.mutations.length).toBeGreaterThan(0);
  });
  it("门名唯一（--gate 靠它选门）", () => {
    const names = GATE_SPECS.map((s) => s.gate);
    expect(new Set(names).size).toBe(names.length);
  });
  it("变异名在同一道门内唯一（报告靠它区分）", () => {
    for (const s of GATE_SPECS) {
      const n = s.mutations.map((m) => m.name);
      expect(new Set(n).size).toBe(n.length);
    }
  });
});
