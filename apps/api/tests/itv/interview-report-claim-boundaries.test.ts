import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessReportClaimBoundaries } from "../../src/application/interview/workflow/interview-report-claim-boundaries";
import { buildReportEvidenceIndex, type ReportEvidence } from "../../src/application/interview/workflow/interview-report-grounding";
import { interviewMarkdown } from "@repo/contracts";

const evidence = (quote: string): ReportEvidence => ({ anchor: "answer-1", documentId: "runs", version: 1,
  sourceHash: "a".repeat(64), start: 0, end: quote.length, quote, expertId: "expert", taskKey: "task", evidenceMode: "simulated", expertLabel: "甲" });
describe("finite report claim boundaries", () => {
 it.each([1,2])("rejects the preserved public attempt %s's unsupported defect exclusion", attempt => {
  const root = new URL("./fixtures/defect-exclusion-5341/", import.meta.url);
  const raw = readFileSync(new URL(`attempt-${attempt}.md`, root), "utf8");
  const saved = JSON.parse(readFileSync(new URL("source.json", root), "utf8"));
  const index = buildReportEvidenceIndex(saved.documents.find((d: {step:string}) => d.step === "runs"));
  expect(assessReportClaimBoundaries(raw,index).missing).toContain("unqualified_defect_exclusion");
 });
 it.each([
  "另一个场景安装顺利，这说明冲突而非设备的固有缺陷。",
  "该设备不存在固有缺陷。",
  "成功案例证明设备并无固有缺陷。",
  "该设备无固有缺陷。",
  "产品无固有缺陷。",
  "成功案例排除了产品固有缺陷。",
  "不能忽略安装成功，所以并非设备的固有缺陷。",
  "不能否认设备不存在固有缺陷。",
  "不能不承认设备不存在固有缺陷。",
  "不能不声称设备不存在固有缺陷。",
  "不能操作该设备所以不存在固有缺陷。",
 ])("does not infer a defect exclusion from scenario heterogeneity: %s", claim => {
  const quote = "另一个场景安装顺利，不能推断普遍发生。";
  expect(assessReportClaimBoundaries(`${claim}[${quote}](#answer-1)`,[evidence(quote)]).missing).toContain("unqualified_defect_exclusion");
 });
 it.each([
  "不能断言设备不存在固有缺陷。",
  "尚不能排除设备固有缺陷。",
  "尚未排除设备固有缺陷。",
  "未能排除产品固有缺陷。",
  "没有证据排除固有缺陷。",
  "产品没有证据排除固有缺陷。",
  "产品无证据排除固有缺陷。",
  "设备并非并无固有缺陷。",
  "设备并非不存在固有缺陷。",
  "产品不是没有固有缺陷。",
  "若经专项检测确认该设备不存在固有缺陷，才考虑环境因素。",
 ])("keeps scoped uncertainty or hypothetical exclusion: %s", claim => {
  expect(assessReportClaimBoundaries(claim,[]).ok).toBe(true);
 });
 it("allows only a source-bound observed exclusion within the same inspected scope", () => {
  const quote = "本次对该设备的供电模块拆机检测确认该设备的供电模块不存在供电设计缺陷。";
  expect(assessReportClaimBoundaries(`${quote}[${quote}](#answer-1)`,[evidence(quote)]).ok).toBe(true);
  expect(assessReportClaimBoundaries(`所有设备不存在固有缺陷。[${quote}](#answer-1)`,[evidence(quote)]).missing).toContain("unqualified_defect_exclusion");
  expect(assessReportClaimBoundaries(`${quote}[另一个场景安装顺利。](#answer-1)`,[evidence(quote)]).missing).toContain("unqualified_defect_exclusion");
  expect(assessReportClaimBoundaries(`${quote}[${quote}](#answer-1)`,[{...evidence(quote),taskKey:null}]).missing).toContain("unqualified_defect_exclusion");
  const overbroad = quote.slice(0,-1)+"，因此所有设备不存在固有缺陷。";
  expect(assessReportClaimBoundaries(`${overbroad}[${overbroad}](#answer-1)`,[evidence(overbroad)]).missing).toContain("unqualified_defect_exclusion");
  for (const prefix of ["我认为", "计划"]) {
    const unobserved = prefix+quote;
    expect(assessReportClaimBoundaries(`${unobserved}[${unobserved}](#answer-1)`,[evidence(unobserved)]).missing).toContain("unqualified_defect_exclusion");
  }
  const wrongObject = "本次对该设备的供电模块拆机检测确认该设备的空间接口不存在固有缺陷。";
  expect(assessReportClaimBoundaries(`${wrongObject}[${wrongObject}](#answer-1)`,[evidence(wrongObject)]).missing).toContain("unqualified_defect_exclusion");
 });
 it.each([
  "不兼容项在本次检测中若为零，只支持本次检测未发现该冲突，不能推翻一般安装风险。",
  "本次检测不兼容项若为零，可考虑试点。",
  "不兼容项数量在此次检查中如果为1,000项，仍需评估误差。",
  "本次测量不兼容项数假如是十二项，需要进一步核查。",
 ])("keeps a condition immediately within the measured proposition: %s", text => {
  expect(assessReportClaimBoundaries(text, []).ok).toBe(true);
 });
 it.each([
  "本次检测不兼容项为零，若预算允许，可继续采购。",
  "本次检测不兼容项在预算若为零时为零。",
  "本次检测不兼容项若需复查，但本次实际测量不兼容项为零。",
 ])("does not waive an observation with another condition: %s", text => {
  expect(assessReportClaimBoundaries(text, []).missing).toContain("unsupported_executed_measurement");
 });
 it.each(["；", ";"])("ends measurement conditional scope at semicolon %s", separator => {
  const text = `本次检测不兼容项若为零${separator}本次检测不兼容项为零。`;
  expect(assessReportClaimBoundaries(text, []).missing).toContain("unsupported_executed_measurement");
 });
 it("does not use a conditional source count as an executed observation", () => {
  const quote = "不兼容项在本次检测中若为零，只支持本次检测未发现该冲突。";
  expect(assessReportClaimBoundaries(`本次检测不兼容项为零。[${quote}](#answer-1)`, [evidence(quote)]).missing).toContain("unsupported_executed_measurement");
 });

 it.each(["本次检测不兼容项是否为零？", "本次检测不兼容项为零吗？"])("does not use a question as an observed count: %s", quote => {
  expect(assessReportClaimBoundaries(`本次检测不兼容项为零。[${quote}](#answer-1)`, [evidence(quote)]).missing).toContain("unsupported_executed_measurement");
 });
 it.each([["十二",12],["二十五",25],["一百零二",102],["一万二千三百四十五",12345]])("normalizes compound count %s", (chinese, numeric) => {
  const quote = `本次检测不兼容项数量为${chinese}项。`;
  expect(assessReportClaimBoundaries(`本次检测不兼容项数量为${numeric}项。[${quote}](#answer-1)`, [evidence(quote)]).ok).toBe(true);
 });
 it("does not treat a grouped numeric question as evidence", () => {
  const quote = "本次检测不兼容项是否为1,000项";
  expect(assessReportClaimBoundaries(`本次检测不兼容项为1000项。[${quote}](#answer-1)`, [evidence(quote)]).missing).toContain("unsupported_executed_measurement");
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

const plannedRaw = readFileSync(new URL('./fixtures/planned-count-5364/report.md', import.meta.url), 'utf8');
const plannedIntro = '以下建议均为待验证的行动方案，需在获取真人证据后方可执行：';
const plannedRow = plannedRaw.split('\n').find(line => line.includes('方法：实地测绘'))!;
const plannedTable = '| 目标 | 步骤 | 条件 | 反例 | 指标 |\n|---|---|---|---|---|\n'+plannedRow;
describe('local planned measurement interpretation', () => {
 it('keeps the preserved complete raw plan interpretation', () => {
  expect(assessReportClaimBoundaries(plannedRaw, []).missing).not.toContain('unsupported_executed_measurement');
 });
 it.each([
  '不兼容项为零仅支持本次检测未发现冲突。',
  plannedRow,
  '```markdown\n'+plannedIntro+'\n'+plannedTable+'\n```\n## 已执行的检测结果\n'+plannedTable,
  '> '+plannedIntro+'\n\n'+plannedTable,
  plannedIntro+'\n## 已执行的检测结果\n'+plannedTable,
  plannedIntro+'\n'+plannedTable+'\n## 检测结果\n'+plannedTable,
  plannedIntro+'\n## 已执行的检测结果\n'+plannedRow,
  plannedIntro+'\n普通段落。\n# '+plannedIntro+'\n'+plannedRow,
  plannedIntro+'\n本次检测结果发现不兼容项为零。',
  '# '+plannedIntro+'\n'+plannedRow,
  plannedIntro+'\n本次实际检测不兼容项为零，仅支持本次检测未发现冲突。',
  plannedIntro+'\n'+plannedRow.replace('注意：', '注意：本次实际检测'),
  plannedIntro+'\n'+plannedRow+'\n本次检测不兼容项为零。',
  plannedIntro+'\n'+plannedRow.replace('指标：记录', '指标：本次已完成检测并记录'),
 ])('does not exempt actual or unscoped counts: %s', text => {
  expect(assessReportClaimBoundaries(text, []).missing).toContain('unsupported_executed_measurement');
 });
 it('preserves exact source-bound actual observations', () => {
  const quote = '本次检测不兼容项为零。';
  expect(assessReportClaimBoundaries(quote+'['+quote+'](#answer-1)', [evidence(quote)]).ok).toBe(true);
  expect(assessReportClaimBoundaries(quote+'['+quote+'](#answer-1)', [{...evidence(quote), taskKey:null}]).missing).toContain('unsupported_executed_measurement');
 });
 it('keeps a genuine local conditional', () => {
  expect(assessReportClaimBoundaries('若检测发现不兼容项为零，则仅支持本次检测未发现冲突。', []).ok).toBe(true);
 });
});
