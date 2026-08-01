/**
 * F85 —— 大纲段落编辑器：AC1「每段都有目标与至少两条开场问法，且目标写在问法前面」
 * （uc-6-2 R3 步骤6，V1）+ 逐段手改（`updateOutlineSection`）+ 确认闸门补上完整性校验。
 *
 * 纯单元测试，不连 Postgres（issue #74：本地只保证纯测试与 typecheck）。
 *
 * ## 这个文件要证的四件事，以及反证
 *
 * 1. **顺序即契约（I-11）**：`objective` 序列化在 `openers` 之前。反证：若哪天有人把
 *    `OutlineSectionDraft` 字段顺序改成 `openers` 在前，这里的 `Object.keys` 断言当场变红。
 * 2. **质量提示计数与实际缺项数一致（V1）**：`countIncompleteSections` 不是「数一遍目标缺失」
 *    就了事——漏统计「开场问法不足两条」的段落，这里用一份「目标齐全但某段只有一条问法」
 *    的大纲当反例，若实现只查 `objective` 会在这里算出 0，测试断言的是非零。
 * 3. **确认闸门真的挡人**：对仍有缺项的大纲调用 `confirmOutline`，断言拒绝
 *    （`OutlineIncompleteError`）而不是「看起来能过」；同一份大纲补完之后同一个调用改为放行——
 *    证明这条门禁挂在「内容是否完整」上，不是恒拒绝的假门，也不是恒放行的假门。
 * 4. **逐段手改的落地效果**：编辑一段的开场问法后，`manuallyEdited` 从 `false` 翻到 `true`，
 *    且已确认的大纲被打回 `pending_confirm`——手改之后必须重新确认，不能让「改过但没人
 *    确认过」的内容继续顶着 `confirmed` 的名义。并发反证：编辑一个已经不存在的
 *    `sectionId`（大纲被别处整体重新生成过）被拒绝，而不是把补丁静默套错地方。
 */
import { describe, expect, it } from "vitest";
import {
  countIncompleteSections,
  generateOutlineDraft,
  isSectionComplete,
  MIN_OPENERS_PER_SECTION,
  totalOutlineMinutes,
  type OutlineSectionDraft,
} from "../../src/domain/interview/outline";
import { confirmOutline } from "../../src/application/interview/confirm-outline";
import { updateOutlineSection } from "../../src/application/interview/update-outline-section";
import { OutlineIncompleteError, OutlineSectionConcurrentModificationError } from "../../src/application/interview/errors";
import { InMemoryOutlineRepository } from "../support/outline-fakes";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-f85-outline-editor");

function section(objective: string, openers: readonly string[], minutes: number, order: number): OutlineSectionDraft {
  return { objective, openers, minutes, order };
}

describe("F85 · AC1 —— 每段都有目标与≥2条开场问法，目标在前", () => {
  it("`objective` 序列化在 `openers` 之前（I-11，顺序即契约）", () => {
    const draft = generateOutlineDraft({
      templateSections: [],
      templateDataFields: [],
      subjects: [],
      context: { who: "运营总监", situation: "年度复盘", decision: "是否调整预算" },
    });
    const keys = Object.keys(draft[0]!);
    expect(keys.indexOf("objective")).toBeLessThan(keys.indexOf("openers"));
  });

  it.each([
    { objective: "确认决策链位置", openers: ["问法一", "问法二"], want: true },
    { objective: "确认决策链位置", openers: ["问法一"], want: false },
    { objective: "", openers: ["问法一", "问法二"], want: false },
    { objective: "  ", openers: ["问法一", "问法二"], want: false },
    { objective: "确认决策链位置", openers: ["问法一", "  "], want: false },
    { objective: "确认决策链位置", openers: ["问法一", "问法二", "问法三"], want: true },
  ])("isSectionComplete($objective, $openers) = $want", ({ objective, openers, want }) => {
    expect(isSectionComplete({ objective, openers })).toBe(want);
  });

  it("质量提示计数統计「目标缺失」与「开场问法不足两条」两类缺项，不只统计其中一类", () => {
    const sections = [
      section("目标齐全两条问法", ["问法一", "问法二"], 10, 0),
      section("", ["问法一", "问法二"], 10, 1), // 目标缺失
      section("目标齐全但只有一条问法", ["问法一"], 10, 2), // 问法不足两条
      section("目标齐全两条问法", ["问法一", "问法二"], 10, 3),
    ];
    expect(countIncompleteSections(sections)).toBe(2);
  });

  it("MIN_OPENERS_PER_SECTION 恒为 2——契约与生成器/校验器共用同一个数", () => {
    expect(MIN_OPENERS_PER_SECTION).toBe(2);
  });

  it("合计时长 = 各段时长之和（[原型] 头部「合计 N 分钟」）", () => {
    const sections = [section("a", ["1", "2"], 5, 0), section("b", ["1", "2"], 20, 1), section("c", ["1", "2"], 20, 2)];
    expect(totalOutlineMinutes(sections)).toBe(45);
  });
});

function harness() {
  const outlines = new InMemoryOutlineRepository();
  return { outlines };
}

async function seedOutline(deps: ReturnType<typeof harness>, sections: OutlineSectionDraft[]) {
  return deps.outlines.create({
    orgId: ORG,
    outlineId: "outline-1",
    interviewId: "itv-1",
    sections,
    generatedBy: "u-researcher",
  });
}

describe("F85 · confirmOutline 补上 AC1 完整性校验", () => {
  it("仍有段落缺目标或问法不足两条时，确认被拒绝（OUTLINE_INCOMPLETE）", async () => {
    const deps = harness();
    await seedOutline(deps, [
      section("目标齐全", ["问法一", "问法二"], 10, 0),
      section("", ["问法一"], 10, 1), // 目标缺失 + 问法不足，仍只算 1 段缺项
    ]);

    await expect(confirmOutline({ outlines: deps.outlines }, { orgId: ORG, outlineId: "outline-1" })).rejects.toThrow(
      OutlineIncompleteError,
    );
  });

  it("补完缺项之后，同一个 confirmOutline 调用改为放行", async () => {
    const deps = harness();
    await seedOutline(deps, [
      section("目标齐全", ["问法一", "问法二"], 10, 0),
      section("", ["问法一"], 10, 1),
    ]);

    await updateOutlineSection(
      { outlines: deps.outlines },
      {
        orgId: ORG,
        outlineId: "outline-1",
        sectionId: "outline-1-sec-1",
        objective: "补上目标",
        openers: ["补的问法一", "补的问法二"],
        minutes: null,
      },
    );

    const confirmed = await confirmOutline({ outlines: deps.outlines }, { orgId: ORG, outlineId: "outline-1" });
    expect(confirmed.status).toBe("confirmed");
  });

  it("每段都齐全的大纲（`generateOutlineDraft` 的产出）首次生成即可确认，不受新校验影响", async () => {
    const deps = harness();
    const draft = generateOutlineDraft({
      templateSections: [],
      templateDataFields: [],
      subjects: [],
      context: { who: "运营总监", situation: "年度复盘", decision: "是否调整预算" },
    });
    await seedOutline(deps, draft);

    const confirmed = await confirmOutline({ outlines: deps.outlines }, { orgId: ORG, outlineId: "outline-1" });
    expect(confirmed.status).toBe("confirmed");
  });
});

describe("F85 · updateOutlineSection —— 逐段手改", () => {
  it("编辑一段后 manuallyEdited 置真；已确认的大纲被打回 pending_confirm", async () => {
    const deps = harness();
    await seedOutline(deps, [section("目标", ["问法一", "问法二"], 10, 0)]);
    await confirmOutline({ outlines: deps.outlines }, { orgId: ORG, outlineId: "outline-1" });

    const beforeEdit = await deps.outlines.getById(ORG, "outline-1");
    expect(beforeEdit?.status).toBe("confirmed");
    expect(beforeEdit?.manuallyEdited).toBe(false);

    const edited = await updateOutlineSection(
      { outlines: deps.outlines },
      {
        orgId: ORG,
        outlineId: "outline-1",
        sectionId: "outline-1-sec-0",
        objective: null,
        openers: ["改过的问法一", "改过的问法二"],
        minutes: null,
      },
    );

    expect(edited.manuallyEdited).toBe(true);
    expect(edited.status).toBe("pending_confirm");
    expect(edited.sections[0]!.openers).toEqual(["改过的问法一", "改过的问法二"]);
    // 没传的字段不被清空——objective/minutes 保留原值。
    expect(edited.sections[0]!.objective).toBe("目标");
    expect(edited.sections[0]!.minutes).toBe(10);
  });

  it("编辑一个已不存在的 sectionId（并发被整体重新生成替换）被拒绝，不静默套错段落", async () => {
    const deps = harness();
    await seedOutline(deps, [section("目标", ["问法一", "问法二"], 10, 0)]);

    await expect(
      updateOutlineSection(
        { outlines: deps.outlines },
        {
          orgId: ORG,
          outlineId: "outline-1",
          sectionId: "outline-1-sec-99",
          objective: "不存在的段落",
          openers: null,
          minutes: null,
        },
      ),
    ).rejects.toThrow(OutlineSectionConcurrentModificationError);
  });

  it("编辑不存在的 outlineId 同样被拒绝", async () => {
    const deps = harness();
    await expect(
      updateOutlineSection(
        { outlines: deps.outlines },
        {
          orgId: ORG,
          outlineId: "outline-does-not-exist",
          sectionId: "sec-0",
          objective: "x",
          openers: null,
          minutes: null,
        },
      ),
    ).rejects.toThrow(OutlineSectionConcurrentModificationError);
  });
});
