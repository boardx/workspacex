import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessReportClaimBoundaries } from "../../src/application/interview/workflow/interview-report-claim-boundaries";
import { buildReportEvidenceIndex, type ReportEvidence } from "../../src/application/interview/workflow/interview-report-grounding";
import { interviewMarkdown } from "@repo/contracts";

const evidence = (quote: string): ReportEvidence => ({ anchor: "answer-1", documentId: "runs", version: 1,
  sourceHash: "a".repeat(64), start: 0, end: quote.length, quote, expertId: "expert", taskKey: "task", evidenceMode: "simulated", expertLabel: "甲" });
describe("finite report claim boundaries", () => {
 it.each(["本次检测不兼容项是否为零？", "本次检测不兼容项为零吗？"])("does not use a question as an observed count: %s", quote => {
  expect(assessReportClaimBoundaries(`本次检测不兼容项为零。[${quote}](#answer-1)`, [evidence(quote)]).missing).toContain("unsupported_executed_measurement");
 });
 it.each([["十二",12],["二十五",25],["一百零二",102],["一万二千三百四十五",12345]])("normalizes compound count %s", (chinese, numeric) => {
  const quote = `本次检测不兼容项数量为${chinese}项。`;
  expect(assessReportClaimBoundaries(`本次检测不兼容项数量为${numeric}项。[${quote}](#answer-1)`, [evidence(quote)]).ok).toBe(true);
 });
 it("keeps an explicit narrow hole exemption", () => {
  expect(assessReportClaimBoundaries("免安装桌面型设备仍需现场检查供电、承重与空间，仅固定孔位此步骤无需。", []).ok).toBe(true);
 });
  it("rejects all three actual failures even with valid unrelated exact quotations and conditional recommendations nearby", () => {
    const root = new URL("./fixtures/claim-boundaries-5332/", import.meta.url);
    const report = readFileSync(new URL("report.md", root), "utf8");
    const source = JSON.parse(readFileSync(new URL("source.json", root), "utf8"));
    const index = buildReportEvidenceIndex(source.documents.find((d: {step:string}) => d.step === "runs"));
    expect(assessReportClaimBoundaries(report, index).missing).toEqual([
      "unsupported_executed_measurement", "unqualified_defect_exclusion", "overbroad_physical_check_exemption",
    ]);
  });
  it.each([
    "本次检测不兼容项为零，下一步是否复核？", "不兼容项在本次检测中为零。", "本次检测的不兼容项数量为０。", "本次检测发现不兼容项为0.0。",
    "本次检测：不兼容项数量为0e0。", "本次检测的不兼容项数量为一。",
    "假设采购条件满足，但不兼容项在本次检测中为零。",
    "尚未检测，不过本次检测不兼容项为零。",
    "前述只是虚构例子，实际本次检测不兼容项为零。",
    "前述只是一个假想例子，但实际本次检测不兼容项为零。",
    "不兼容项在本次检测中为零，这里的虚构例子指的是预算为零。",
    "例如，本次检测不兼容项为零。", "例如，实际本次检测不兼容项为零。", "例如不兼容项在本次检测中为零。",
  ])("rejects executed count without matching evidence: %s", text => {
    expect(assessReportClaimBoundaries(text, []).missing).toContain("unsupported_executed_measurement");
  });
  it.each([
    "若未来检测不兼容项为零，可考虑试点；还需核对供电条件。", "本次尚未检测，不能声称不兼容项为零。",
    "如果未来检测结果显示不兼容项为零，可考虑试点。", "若未来的现场检测发现不兼容项为零，可考虑试点。",
    "不兼容项为零不能作为通用安全证明。", "计划测量不兼容项数量，以零作为待验证目标。",
    "例如，不兼容项在本次检测中为零只是一个虚构例子。", "本次问卷零人回答；预算为零。",
    "在虚构例子中，本次检测不兼容项为零。",
    "若未来检测结果显示不兼容项为零，可考虑试点，仍需核对供电。",
    "服务端绑定任务数为2，画像数为2。", "安装风险尚不能排除产品固有缺陷。",
    "不能断言安装风险不是产品固有缺陷。", "不是说产品没有缺陷。",
    "若免安装桌面型设备仅免固定孔位检查，供电、承重与空间仍需核对。",
    "旧流程已失效，预算审批需要重做。",
    "不能断言整套物理勘测完全无用。", "整套物理勘测并非完全无用。",
    "不能说整套物理勘测完全无用。", "整套现场检查并非失效，仍需检查供电。", "本次检测不兼容项不是零。",
    "不能声称桌面型设备使整套现场检查失效。",
    "若采购免安装桌面型咖啡机，此步骤并非失效，仍需物理勘测核对供电、承重。",
    "`不兼容项在本次检测中为零。`\n\n```text\n安装风险不是产品固有缺陷。\n```",
  ])("allows bounded or unrelated prose without imposing a writing template: %s", text => {
    expect(assessReportClaimBoundaries(text, []).ok).toBe(true);
  });
  it.each(["零", "０", "0.0", "0e0", "一", "1", "１", "1.5", "１．５", "10%", "１０％", "1,000", "１，０００"])("accepts exact source observation with matching object/status/value %s", value => {
    const quote = `本次检测发现不兼容项数量为${value}。`;
    expect(assessReportClaimBoundaries(`${quote} [${quote}](#answer-1)`, [evidence(quote)]).ok).toBe(true);
  });
  it("retains grouped numbers as one count and binds the fictional suffix after that count", () => {
    const quote = "本次检测不兼容项为1。";
    expect(assessReportClaimBoundaries(`本次检测不兼容项为1,000。[${quote}](#answer-1)`, [evidence(quote)]).ok).toBe(false);
    expect(assessReportClaimBoundaries("本次检测不兼容项为1,000只是一个虚构例子。", []).ok).toBe(true);
  });
  it("does not waive measurement with arbitrary valid quote, wrong count, hypothetical source or unbound quote", () => {
    for (const quote of ["另一个场景安装顺利。", "本次检测不兼容项为一。", "若未来检测不兼容项为零，可试点。"])
      expect(assessReportClaimBoundaries(`不兼容项在本次检测中为零。[${quote}](#answer-1)`, [evidence(quote)]).ok).toBe(false);
    expect(assessReportClaimBoundaries("不兼容项在本次检测中为零。[本次检测不兼容项为零。](#answer-1)", []).ok).toBe(false);
  });
  it("repeated valid count citation remains valid; exact quoted content alone is not a narrator assertion", () => {
    const quote = "本次检测不兼容项为零。";
    expect(assessReportClaimBoundaries(`记录：[${quote}](#answer-1) [${quote}](#answer-1)`, [evidence(quote)]).ok).toBe(true);
  });
  it("checks split table observations but keeps default grounding cell scope unchanged", () => {
    const table = "| 状态 | 对象 | 数值 |\n|---|---|---|\n| 本次检测 | 不兼容项 | ０ |";
    expect(assessReportClaimBoundaries(table, []).missing).toContain("unsupported_executed_measurement");
    expect(interviewMarkdown.parseInterviewReportAssertions(table).map(a=>a.text)).toEqual(["状态","对象","数值","本次检测","不兼容项","０"]);
    const quote = "本次检测不兼容项为零。";
    expect(assessReportClaimBoundaries(table.slice(0,-1)+` [${quote}](#answer-1) |`, [evidence(quote)]).ok).toBe(true);
  });
  it.each([
    "安装风险不是产品固有缺陷，而是环境交互的结果。", "尚不能排除缺陷，但确定安装风险不是产品固有缺陷。",
    "假设需要核对供电，但安装风险不是产品固有缺陷。",
    "如果想要推进采购，不兼容项在本次检测中为零。",
    "不能忽略证据，安装风险不是产品固有缺陷。",
    "建议补充验证，安装风险不是产品固有缺陷。", "只有预算审核计划推迟，本次检测不兼容项为零。",
    "不是说预算有问题，安装风险不是产品固有缺陷。",
    "不能说整套现场检查并非失效。", "不能断言不是整套物理勘测完全无用。",
    "免安装桌面型咖啡机使整套物理勘测完全无用。", "供电仍需检查，不过整套物理勘测完全无用。",
    "| 步骤 | 反例 |\n|---|---|\n| 核对插座、承重与柜体孔位的物理勘测 | 若采购免安装桌面型咖啡机，此步骤失效。 |",
  ])("rejects unqualified exclusion or whole-check exemption: %s", text => expect(assessReportClaimBoundaries(text, []).ok).toBe(false));
  it("does not turn a statement quoted by a participant into a verified defect exclusion", () => {
    const quote = "安装风险不是产品固有缺陷。";
    expect(assessReportClaimBoundaries(`原话：[${quote}](#answer-1)。这仍是未验证观点，不能排除产品缺陷。`, [evidence(quote)]).ok).toBe(true);
    expect(assessReportClaimBoundaries(`安装风险不是产品固有缺陷。[${quote}](#answer-1)`, [evidence(quote)]).ok).toBe(false);
  });
});
