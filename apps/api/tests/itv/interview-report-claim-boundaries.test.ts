import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessReportClaimBoundaries } from "../../src/application/interview/workflow/interview-report-claim-boundaries";
import { buildReportEvidenceIndex, type ReportEvidence } from "../../src/application/interview/workflow/interview-report-grounding";
import { interviewMarkdown } from "@repo/contracts";

const evidence = (quote: string): ReportEvidence => ({ anchor: "answer-1", documentId: "runs", version: 1,
  sourceHash: "a".repeat(64), start: 0, end: quote.length, quote, expertId: "expert", taskKey: "task", evidenceMode: "simulated", expertLabel: "甲" });
describe("finite report claim boundaries", () => {
 it("preserves byte-exact final public risk denial", () => {
  const raw = readFileSync(new URL("./fixtures/risk-denial-5343/report.md", import.meta.url), "utf8").split("\n")[29];
  if (raw === undefined) throw new Error("Missing public raw line 30");
  expect(assessReportClaimBoundaries(raw,[]).missing).not.toContain("unsupported_physical_risk_downgrade");
 });
 it.each(["采用移动插座，不能据此断言供电风险已经降低。", "改用桌面型，无法据此确认承重风险已消除。"])("preserves immediate epistemic risk prohibition: %s", raw => {
  expect(assessReportClaimBoundaries(raw,[]).missing).not.toContain("unsupported_physical_risk_downgrade");
 });
 it.each(["采用移动插座，不是说不能据此断言供电风险已降低。", "采用移动插座，并非真的不能据此断言供电风险已降低。", "采用移动插座，并非不能据此断言供电风险已降低。", "采用移动插座，不是无法据此确认供电风险已消除。", "不能据此断言移动插座合适，但供电风险已降低。", "采用移动插座，不能据此断言预算合适，供电风险已降低。"])("does not waive definite risk reduction: %s", raw => {
  expect(assessReportClaimBoundaries(raw,[]).missing).toContain("unsupported_physical_risk_downgrade");
 it.each([4,5,8])("does not erase outer denial with %s spaces", spaces => {
  expect(assessReportClaimBoundaries(`并非${" ".repeat(spaces)}不证明当前采购已经搁置。`,[]).missing).toContain("unsupported_current_decision_state");
 });
 it("does not erase outer denial beyond four modifier tokens", () => {
  expect(assessReportClaimBoundaries("并非真的完全明确直接确实不证明当前采购已经搁置。",[]).missing).toContain("unsupported_current_decision_state");
 });
 it.each(["不证明张采购者目前这笔咖啡机采购已暂停。", "不证明张李王赵采购者目前这笔咖啡机采购已暂停。"])("preserves bounded named role denial: %s", raw => {
  expect(assessReportClaimBoundaries(raw,[]).missing).not.toContain("unsupported_current_decision_state");
 });
 it.each(["并非真的不证明张采购者目前这笔咖啡机采购已暂停。", "不证明张李王赵钱采购者目前这笔咖啡机采购已暂停。", `并非${"真的".repeat(70)}不证明当前采购已暂停。`])("fails closed for outer or oversized role denial: %s", raw => {
  expect(assessReportClaimBoundaries(raw,[]).missing).toContain("unsupported_current_decision_state");
 });
 it.each([15,64])("preserves byte-exact final public state denial at line %s", line => {
  const raw = readFileSync(new URL("./fixtures/decision-denial-5342/report.md", import.meta.url), "utf8").split("\n")[line-1];
  if (raw === undefined) throw new Error(`Missing public raw line ${line}`);
  expect(assessReportClaimBoundaries(raw,[]).missing).not.toContain("unsupported_current_decision_state");
 });
 it.each(["当前采购状态无法确认为永久搁置。", "不证明当前真实采购已经搁置。"])("preserves local epistemic state denial: %s", raw => {
  expect(assessReportClaimBoundaries(raw,[]).missing).not.toContain("unsupported_current_decision_state");
 });
 it.each(["当前采购状态并非无法确认为永久搁置。", "并非不证明当前真实采购已经搁置。", "并非真的不证明当前真实采购已经搁置。", "不能明确说不证明当前真实采购已经搁置。", "不能不证明当前真实采购已经搁置。", "不证明预算不足，但当前真实采购已经搁置。", "当前采购状态无法确认预算，而当前采购已暂停。"])("does not let denial waive a positive state: %s", raw => {
  expect(assessReportClaimBoundaries(raw,[]).missing).toContain("unsupported_current_decision_state");
 });
 it.each(["采用移动插座，因此供电风险降低。", "改用移动插座消除了线缆风险。", "移动插座并非没有降低供电风险。", "供电风险已得到降低，采用移动插座。"])("rejects unmarked definite risk reduction: %s", claim => {
  expect(assessReportClaimBoundaries(claim,[]).missing).toContain("unsupported_physical_risk_downgrade");
 });
 it("activates the gate from exact bound setup evidence without promoting its quote", () => {
  const quote = "受访者建议采用移动插座。";
  expect(assessReportClaimBoundaries(`[${quote}](#answer-1) 因此供电风险已降低。`,[evidence(quote)]).missing).toContain("unsupported_physical_risk_downgrade");
  expect(assessReportClaimBoundaries(`[${quote}](#answer-1) 供电风险尚待验证。`,[evidence(quote)]).ok).toBe(true);
 });
 it.each(["供电回路的现场负荷检测确认供电风险已降低", "承重结构的专项检测确认承重风险已降低", "线缆路径的安全检测确认线缆风险已降低"])("accepts exact site/object/method risk evidence: %s", result => {
  const quote = `本次对该办公区${result}。`;
  const claim = `采用移动插座，${quote}`;
  expect(assessReportClaimBoundaries(`${claim}[${quote}](#answer-1)`,[evidence(quote)]).ok).toBe(true);
  expect(assessReportClaimBoundaries(`${claim.replace("办公区","会议室")}[${quote}](#answer-1)`,[evidence(quote)]).missing).toContain("unsupported_physical_risk_downgrade");
 });
 it.each(["移动插座可能降低供电风险。", "建议采用移动插座降低供电风险。", "移动插座尚未消除线缆风险。"])("preserves scoped modal reverse risk predicates: %s", claim => {
  expect(assessReportClaimBoundaries(claim,[]).ok).toBe(true);
 });
 it.each([1,2])("rejects preserved public attempt %s's automatic physical-risk downgrade", attempt => {
  const root = new URL("./fixtures/defect-exclusion-5341/", import.meta.url);
  const raw = readFileSync(new URL(`attempt-${attempt}.md`, root), "utf8");
  const saved = JSON.parse(readFileSync(new URL("source.json", root), "utf8"));
  const index = buildReportEvidenceIndex(saved.documents.find((d: {step:string}) => d.step === "runs"));
  expect(assessReportClaimBoundaries(raw,index).missing).toContain("unsupported_physical_risk_downgrade");
 });
 it.each([
  "若办公区采用移动式带线插座或无固定柜体，则该物理冲突风险自动降级。",
  "改用移动插座后，供电风险自动降低。仍需检查线缆。",
  "无固定柜体，所以空间风险已经消除。",
  "不能确认安装成本，但采用移动插座后物理风险必然降低。",
  "不能否认采用移动插座后供电风险自动降低。",
  "采用移动插座后供电风险并非没有自动降低。",
  "采用移动插座后供电风险不是尚未自动降低。",
  "采用移动插座后供电风险并非没有得到降低。",
  "移动插座并非没有降低供电风险。",
  "采用移动插座并非不会消除供电风险。",
  "采用移动插座不是未降低供电风险。",
 ])("does not treat a changed setup as verified risk reduction: %s", claim => {
  const quote = "另一个场景安装顺利，不能推断普遍发生。";
  expect(assessReportClaimBoundaries(`${claim}[${quote}](#answer-1)`,[evidence(quote)]).missing).toContain("unsupported_physical_risk_downgrade");
 });
 it.each([
  "若采用移动插座，还需验证物理风险是否降低，并检查负荷与线缆。",
  "无固定柜体仅可省略固定孔位检查，供电、承重与空间仍需检查。",
  "不能断言采用移动插座后供电风险自动降低。",
  "采用移动插座后物理风险并非自动降低。",
  "采用移动插座后供电风险没有自动降低。",
  "采用移动插座后供电风险尚未自动降低。",
  "采用移动插座后供电风险没有得到降低。",
  "移动插座并非降低供电风险。",
  "采用移动插座并不降低供电风险。",
  "采用移动插座不会消除供电风险。",
  "采用移动插座未降低供电风险。",
  "移动插座可能减轻孔位冲突，但线缆与供电仍待验证。",
  "若移动插座经现场负荷检测确认供电风险已降低，才调整供电检查频率。",
  "采用移动插座后，供电风险已降低吗？需要现场验证。",
 ])("preserves pending risk hypotheses and narrow hole-check advice: %s", claim => {
  expect(assessReportClaimBoundaries(claim,[]).ok).toBe(true);
 });
 it("keeps recorded narrow checks separate from other risks and setup proposals", () => {
  const quote = "本次对该办公区固定孔位的现场复核确认该固定孔位冲突风险已降低。";
  const claim = `改用移动插座后，${quote}`;
  expect(assessReportClaimBoundaries(`${claim}[${quote}](#answer-1)`,[evidence(quote)]).ok).toBe(true);
  for (const unsafe of ["改用移动插座后，供电风险已降低。", "改用移动插座后，物理风险已降低。", "改用移动插座后，本次对该会议室固定孔位的现场复核确认该固定孔位冲突风险已降低。"])
    expect(assessReportClaimBoundaries(`${unsafe}[${quote}](#answer-1)`,[evidence(quote)]).missing).toContain("unsupported_physical_risk_downgrade");
  expect(assessReportClaimBoundaries(`${claim}[${quote}](#answer-1)`,[{...evidence(quote),taskKey:null}]).missing).toContain("unsupported_physical_risk_downgrade");
  const plan = quote.replace("本次", "计划");
  expect(assessReportClaimBoundaries(`${claim}[${plan}](#answer-1)`,[evidence(plan)]).missing).toContain("unsupported_physical_risk_downgrade");
  expect(assessReportClaimBoundaries(`改用移动插座后的原话：[${quote}](#answer-1)`,[evidence(quote)]).ok).toBe(true);
 });
 it.each(["这笔采购处于暂停状态。", "这笔购买处于中断状态。"])("rejects unsupported present-state copula: %s", claim => {
  expect(assessReportClaimBoundaries(claim,[]).missing).toContain("unsupported_current_decision_state");
 });
 it.each(["建议提前确认预算，避免当前采购暂停。", "为防止目前采购流程中断，应先确认库存。"])("preserves prevention rather than asserting its outcome: %s", claim => {
  expect(assessReportClaimBoundaries(claim,[]).ok).toBe(true);
 });
 it.each(["根据访谈，张采购者目前这笔咖啡机采购已暂停。", "原文显示：张采购者目前这笔咖啡机采购已暂停。", "张采购者表示：目前这笔咖啡机采购已暂停。"])("matches attributed state without changing identity: %s", claim => {
  const quote = "张采购者目前这笔咖啡机采购已暂停。";
  expect(assessReportClaimBoundaries(`${claim}[${quote}](#answer-1)`,[evidence(quote)]).ok).toBe(true);
  expect(assessReportClaimBoundaries(`${claim.replace("张采购者","李采购者")}[${quote}](#answer-1)`,[evidence(quote)]).missing).toContain("unsupported_current_decision_state");
 });
 it("does not turn a source hypothetical suffix into an observed state", () => {
  const claim = "张采购者目前这笔咖啡机采购已暂停。";
  const quote = "张采购者目前这笔咖啡机采购已暂停只是一个假设。";
  expect(assessReportClaimBoundaries(`${claim}[${quote}](#answer-1)`,[evidence(quote)]).missing).toContain("unsupported_current_decision_state");
 });
 it.each([1,2])("rejects preserved public attempt %s's future-plan to current-state inference", attempt => {
  const root = new URL("./fixtures/defect-exclusion-5341/", import.meta.url);
  const raw = readFileSync(new URL(`attempt-${attempt}.md`, root), "utf8");
  const saved = JSON.parse(readFileSync(new URL("source.json", root), "utf8"));
  const index = buildReportEvidenceIndex(saved.documents.find((d: {step:string}) => d.step === "runs"));
  expect(assessReportClaimBoundaries(raw,index).missing).toContain("unsupported_current_decision_state");
 });
 it.each([
  "再决定投入表明当前采购处于搁置状态。",
  "不能确认预算，但当前采购已暂停。",
  "不能确认预算；当前采购已暂停。",
  "不能否认当前采购已经搁置。",
  "不能不承认当前采购已经搁置。",
  "不能不声称当前采购已暂停。",
  "不能声称预算足够，但当前采购已暂停。",
  "当前采购决策并非没有暂停。",
  "当前采购决策不是没有搁置。",
  "不能避免当前采购暂停。",
  "无法避免当前采购暂停。",
  "不能防止当前采购搁置。",
  "无法防止当前采购搁置。",
  "不能防止目前采购流程中断。",
  "未能避免当前采购暂停。",
  "不能避免张采购者目前这笔咖啡机采购已暂停。",
  "不能断言预算足够，但张采购者目前这笔咖啡机采购已暂停。",
 ])("does not establish a present decision state with a future plan: %s", claim => {
  const plan = "访谈五位采购用户，再决定投入。";
  expect(assessReportClaimBoundaries(`${claim}[${plan}](#answer-1)`,[evidence(plan)]).missing).toContain("unsupported_current_decision_state");
 });
 it.each([
  "未来访谈五位用户，再决定投入。",
  "不能据此断言当前采购已经搁置。",
  "无法判断当前采购是否暂停。",
  "若当前采购已暂停，可以先验证替代方案。",
  "若张采购者目前这笔咖啡机采购已暂停，可以先验证替代方案。",
  "当前采购可能暂缓，需核实实际状态。",
  "当前采购并未搁置。",
  "当前采购并非暂停状态。",
  "当前采购不是搁置状态。",
  "不能声称当前采购已暂停。",
  "不能断言张采购者目前这笔咖啡机采购已暂停。",
  "无法确认张采购者目前这笔咖啡机采购已暂停。",
  "避免张采购者目前这笔咖啡机采购已暂停。",
 ])("preserves a plan, scoped denial, question or conditional state: %s", claim => {
  expect(assessReportClaimBoundaries(claim,[]).ok).toBe(true);
 });
 it("preserves the same observed person, decision object and current time window", () => {
  const quote = "张采购者目前这笔咖啡机采购已暂停。";
  expect(assessReportClaimBoundaries(`${quote}[${quote}](#answer-1)`,[evidence(quote)]).ok).toBe(true);
  for (const claim of ["李采购者目前这笔咖啡机采购已暂停。", "张采购者目前这笔饮水机采购已暂停。"])
    expect(assessReportClaimBoundaries(`${claim}[${quote}](#answer-1)`,[evidence(quote)]).missing).toContain("unsupported_current_decision_state");
  const past = "张采购者去年这笔咖啡机采购已暂停。";
  expect(assessReportClaimBoundaries(`${quote}[${past}](#answer-1)`,[evidence(past)]).missing).toContain("unsupported_current_decision_state");
  expect(assessReportClaimBoundaries(`${quote}[${quote}](#answer-1)`,[{...evidence(quote),taskKey:null}]).missing).toContain("unsupported_current_decision_state");
  expect(assessReportClaimBoundaries(`原话：[${quote}](#answer-1)`,[evidence(quote)]).ok).toBe(true);
 });
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
