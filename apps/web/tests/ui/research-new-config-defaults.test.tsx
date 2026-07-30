/**
 * F144 / V2 · 新建深度研究：**七组字段的逐项默认值**（`uc-24-1` R3 表 · R7.5 · R12.2 / R12.9）
 *
 * ## 为什么这条测试非有不可
 * `uc-24-1` R7.5 逐字：「默认值不得自行改向……本仓已因**默认值画反**判过一次重做
 * （`PROTOTYPE-SWEEP-UI.md` P-05）」。而那次事故的要害是：
 * **看截图看不出来默认值画反**——一个勾选框画成勾中还是没勾中，人眼扫过去都「像对的」。
 * ⇒ 所以本文件把 R3 表里的七组默认值**逐项写死成字面量**，不从被测代码里取。
 *   从 `RS_CONFIG_DEFAULT` 取来再断言它等于自己，是一条恒真的空转。
 *
 * ## 断的是「恰好这些」，不是「至少这些」
 * 多选两组（来源偏好 / 交付形式）用**集合相等**断：勾中集合 == 期望集合。
 * 只断「官方与监管被勾中」的写法漏得掉「五项全勾中」这种画反。
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NewResearchPanel } from "@/components/research-studio/new-research";
import {
  RS_KINDS, RS_DEPTHS, RS_SOURCES, RS_DELIVERABLES, RS_GROUPS, RS_NODES,
} from "@/lib/mock/research-studio";
import { ResearchKind, ResearchDepth, SourceKind, Deliverable } from "@repo/contracts/research";

/* ── `uc-24-1` R3 表逐字。改这里 = 改需求，必须先改 UC。 ────────────────── */
const R3_SCENE = "业主第一次评估储能投资，卡在并网时间不确定";
const R3_QUESTION = "德国并网审批的真实中位时长是多少，材料返工会加多久";
const R3_KIND = "desk";                                     // 桌面研究
const R3_DEPTH = "std";                                     // 标准
const R3_SOURCES = ["官方与监管", "行业报告"];               // 五选二
const R3_DELIVERABLES = ["研究简报"];                        // 四选一
const R3_GROUP = "all";                                     // 全场共用
const R3_NODE = "n1";                                       // 决策节点：资质可随股权转移？

/** 某一组里被标为选中的短码集合（断 `data-selected`，不是 class，也不是像素）。 */
function selectedIn(prefix: string, codes: readonly string[]): string[] {
  return codes.filter((c) => screen.getByTestId(`${prefix}-${c}`).getAttribute("data-selected") === "true");
}

describe("F144 · 七组字段的默认值逐项等于 uc-24-1 R3 表", () => {
  it("① 两个长文本：研究场景 / 要回答的问题", () => {
    render(<NewResearchPanel />);
    expect((screen.getByTestId("rs-input-scene") as HTMLTextAreaElement).value).toBe(R3_SCENE);
    expect((screen.getByTestId("rs-input-question") as HTMLTextAreaElement).value).toBe(R3_QUESTION);
  });

  it("③ 研究类型：**恰好** desk 被选中，另外三项都没有", () => {
    render(<NewResearchPanel />);
    expect(selectedIn("rs-kind", RS_KINDS.map((k) => k.code))).toEqual([R3_KIND]);
  });

  it("④ 深度与时间盒：**恰好** std（标准）被选中", () => {
    render(<NewResearchPanel />);
    expect(selectedIn("rs-depth", RS_DEPTHS.map((d) => d.code))).toEqual([R3_DEPTH]);
  });

  it("⑤ 来源偏好：勾中集合**恰好** = {官方与监管, 行业报告}", () => {
    render(<NewResearchPanel />);
    expect(new Set(selectedIn("rs-source", RS_SOURCES))).toEqual(new Set(R3_SOURCES));
    // 反向：另外三项一个都不许被勾中（这半条才是「画反」真正会踩到的地方）
    for (const s of RS_SOURCES.filter((x) => !R3_SOURCES.includes(x))) {
      expect(screen.getByTestId(`rs-source-${s}`).getAttribute("data-selected"), `${s} 被默认勾中了`).toBe("false");
    }
  });

  it("⑥ 交付形式：勾中集合**恰好** = {研究简报}", () => {
    render(<NewResearchPanel />);
    expect(new Set(selectedIn("rs-deliverable", RS_DELIVERABLES))).toEqual(new Set(R3_DELIVERABLES));
    for (const d of RS_DELIVERABLES.filter((x) => !R3_DELIVERABLES.includes(x))) {
      expect(screen.getByTestId(`rs-deliverable-${d}`).getAttribute("data-selected"), `${d} 被默认勾中了`).toBe("false");
    }
  });

  it("⑦ 挂到哪一组 = 全场共用；哪个决策节点 = n1", () => {
    render(<NewResearchPanel />);
    expect((screen.getByTestId("rs-input-group") as HTMLSelectElement).value).toBe(R3_GROUP);
    expect((screen.getByTestId("rs-input-node") as HTMLSelectElement).value).toBe(R3_NODE);
  });

  it("七组字段一组不少地渲染出来（少画一组，上面几条不会红）", () => {
    render(<NewResearchPanel />);
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      expect(screen.getAllByTestId(`rs-field-${n}`).length, `第 ${n} 组字段没渲染`).toBeGreaterThanOrEqual(1);
    }
  });

  it("A1 · 从小组能力面进入时「组」被预填为该组（覆盖默认的 all）", () => {
    render(<NewResearchPanel initial={{
      scene: R3_SCENE, question: R3_QUESTION, kind: R3_KIND, depth: R3_DEPTH,
      sources: [...R3_SOURCES], deliverables: [...R3_DELIVERABLES], groupRef: "g2", nodeRef: R3_NODE,
    }} />);
    expect((screen.getByTestId("rs-input-group") as HTMLSelectElement).value).toBe("g2");
  });
});

describe("F144 · 选项的**值域**取自契约，界面不另立一份枚举", () => {
  /*
   * 默认值本身刻意**不在**契约里（`research.ts` 的 `ResearchConfig` 注：默认值属界面层，
   * 写进契约就是第二份声明）。但**值域**必须是契约那一份——
   * 界面多一项 / 少一项 / 拼错一个字，下面四条当场红。
   */
  it("四类型 / 三档时间盒 / 五来源 / 四交付 的值域与契约逐项相等", () => {
    expect(RS_KINDS.map((k) => k.code)).toEqual(ResearchKind.options);
    expect(RS_DEPTHS.map((d) => d.code)).toEqual(ResearchDepth.options);
    expect([...RS_SOURCES]).toEqual(SourceKind.options);
    expect([...RS_DELIVERABLES]).toEqual(Deliverable.options);
  });

  it("默认值都落在各自的值域内（默认了一个不存在的取值 = 画反的另一种形态）", () => {
    expect(ResearchKind.options).toContain(R3_KIND);
    expect(ResearchDepth.options).toContain(R3_DEPTH);
    for (const s of R3_SOURCES) expect(SourceKind.options).toContain(s);
    for (const d of R3_DELIVERABLES) expect(Deliverable.options).toContain(d);
    expect(RS_GROUPS.map((g) => g.ref)).toContain(R3_GROUP);
    expect(RS_NODES.map((n) => n.ref)).toContain(R3_NODE);
  });

  it("反空转：期望集合非空，且默认勾中的**不是**全集（默认全选是最常见的画反）", () => {
    expect(R3_SOURCES.length).toBe(2);
    expect(SourceKind.options.length).toBeGreaterThan(R3_SOURCES.length);
    expect(R3_DELIVERABLES.length).toBe(1);
    expect(Deliverable.options.length).toBeGreaterThan(R3_DELIVERABLES.length);
  });
});
