/**
 * F144 / V3 · 预览句**实时重算**（`uc-24-1` R3.3 · R12.3 · N-4 / N-12）
 *
 * ## 断言打在「性质」上，不是固定字符串
 * `feature_list` F144 的 `notes` 逐字：「预览句断言要打在**性质**上（包含所选来源的全部名称），
 * 不是断言某个固定字符串——深度档位有两串文案（`nrDepths[].note` vs `DEPTH_L`），
 * **哪串权威 Q-1 未裁**，契约刻意一串都不落（`KNOWN_CONTRACT_GAPS.R2`）」。
 * ⇒ 本文件**不写死整句**。断的是三条性质：
 *   P1 所选来源的**全部**名称出现在句子里；
 *   P2 **未选**的来源名称**不出现**（只断 P1 的话，「把五个来源全拼进去」也能全绿）；
 *   P3 改动字段后句子**变了**（证明它是算出来的，不是渲染了一个常量）。
 *
 * ## 为什么 P2 必须在
 * 预览句逐字承诺「来源**限定**在 {…}」，而 R7.1 把它升格为**执行契约**：
 * `uc-24-2` 的检索不得越出所选来源偏好。一个把全集拼进去的预览句，
 * 会让用户以为自己限定了范围而其实没有。
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NewResearchPanel } from "@/components/research-studio/new-research";
import { RS_SOURCES, RS_DEPTHS, RS_KINDS } from "@/lib/mock/research-studio";

const preview = () => screen.getByTestId("rs-preview").textContent ?? "";

/** P1 + P2 一起断：句子对来源的引用**恰好** = 勾中集合。 */
function expectSourcesExactly(selected: readonly string[]) {
  const text = preview();
  for (const s of selected) {
    expect(text, `预览句漏了已选来源「${s}」`).toContain(s);
  }
  for (const s of RS_SOURCES.filter((x) => !selected.includes(x))) {
    expect(text, `预览句里出现了**未选**的来源「${s}」——「来源限定在…」这句话就成了假的`).not.toContain(s);
  }
}

describe("F144 · 预览句是算出来的：随字段实时重算", () => {
  it("默认态：句子恰好引用默认勾中的两个来源", () => {
    render(<NewResearchPanel />);
    expectSourcesExactly(["官方与监管", "行业报告"]);
  });

  it("勾上第三个来源 ⇒ 三个名称全在句子里（P1）", () => {
    render(<NewResearchPanel />);
    const before = preview();
    fireEvent.click(screen.getByTestId("rs-source-媒体报道"));
    expect(preview(), "勾了来源，预览句一个字没变 ⇒ 它是写死的").not.toBe(before);
    expectSourcesExactly(["官方与监管", "行业报告", "媒体报道"]);
  });

  it("取消勾选一个来源 ⇒ 它从句子里消失（P2）", () => {
    render(<NewResearchPanel />);
    fireEvent.click(screen.getByTestId("rs-source-官方与监管"));
    expectSourcesExactly(["行业报告"]);
  });

  it("改研究类型 ⇒ 句子里的类型中文跟着换", () => {
    render(<NewResearchPanel />);
    const deskLabel = RS_KINDS.find((k) => k.code === "desk")!.label;
    const regLabel = RS_KINDS.find((k) => k.code === "reg")!.label;
    expect(preview()).toContain(deskLabel);
    fireEvent.click(screen.getByTestId("rs-kind-reg"));
    expect(preview()).toContain(regLabel);
    expect(preview()).not.toContain(deskLabel);
  });

  it("改深度档位 ⇒ 句子用**预览串** depthL，而不是卡片串 note", () => {
    render(<NewResearchPanel />);
    const deep = RS_DEPTHS.find((d) => d.code === "deep")!;
    fireEvent.click(screen.getByTestId("rs-depth-deep"));
    expect(preview(), "深挖档的预览串没进句子").toContain(deep.depthL);
    /*
     * ⚠ 这一条**不是**在裁 Q-1（哪串权威未定）。它断的是「两串确实不同、
     * 且句子用的是 buildPreview 里那一串」——两串一旦被谁悄悄统一，这条会红，
     * 那正是需要人来看一眼的时刻。
     */
    expect(deep.note).not.toBe(deep.depthL);
  });

  it("改交付形式 ⇒ 句子里的产出跟着变", () => {
    render(<NewResearchPanel />);
    expect(preview()).toContain("研究简报");
    fireEvent.click(screen.getByTestId("rs-deliverable-对比表"));
    expect(preview()).toContain("对比表");
    expect(preview()).toContain("研究简报");
  });

  it("R7.4 · 选「不挂节点」⇒ 句子改口说只存进洞察库，不再承诺回流", () => {
    render(<NewResearchPanel />);
    expect(preview()).toContain("结论回流到所选决策节点并标注置信度");
    fireEvent.change(screen.getByTestId("rs-input-node"), { target: { value: "n0" } });
    expect(preview()).toContain("只存进洞察库，不回流决策节点");
    expect(preview()).not.toContain("结论回流到所选决策节点并标注置信度");
  });

  it("Q-5 未裁 · 来源全不选：**不拦**，句子显式说「未选来源」", () => {
    render(<NewResearchPanel />);
    fireEvent.click(screen.getByTestId("rs-source-官方与监管"));
    fireEvent.click(screen.getByTestId("rs-source-行业报告"));
    expectSourcesExactly([]);
    expect(preview()).toContain("未选来源");
  });

  it("反空转：RS_SOURCES 非空且各名称互不为子串（否则 P2 的 not.toContain 会假红/假绿）", () => {
    expect(RS_SOURCES.length).toBeGreaterThanOrEqual(5);
    for (const a of RS_SOURCES) {
      for (const b of RS_SOURCES) {
        if (a !== b) expect(a.includes(b), `「${a}」包含「${b}」——子串断言不可靠`).toBe(false);
      }
    }
  });
});
