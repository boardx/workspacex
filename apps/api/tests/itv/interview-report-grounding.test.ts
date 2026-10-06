import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { interviewMarkdown } from "@repo/contracts";
import { buildReportEvidenceIndex, reportEvidenceContext, validateReportEvidence } from "../../src/application/interview/workflow/interview-report-grounding";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const raw = "服务端甲回答：支持电话。\n## [客服](#expert-b)\nQ2：反对电话。\nQ2：厨房孔位冲突。";
const source: interviewMarkdown.InterviewMarkdownDocument = { documentId: "md-runs", version: 2, step: "runs", markdown: raw, contentHash: hash(raw), evidenceMode: "simulated", references: [], answerSpans: [{ taskKey: "rev-a/expert-a", expertId: "expert-a", start: 0, end: raw.length, contentHash: hash(raw) }] };
describe("report evidence grounding", () => {
 it.each(["无法得出“预算不足因此必然阻止购买”的结论。", "无法得出预算不足所以必然阻止购买的结论。", "无法得出“因此预算必然阻止购买”的结论。", "无法得出“所以预算必然阻止购买”的结论。", "无法得出“研究结论表明预算必然阻止购买”的结论。", "无法得出研究结论表明预算必然阻止购买的结论。"])("keeps causal words inside one denied conclusion: %s", line => {
  expect(validateReportEvidence(`[服务端甲回答：支持电话。](#answer-1)\n\n${line}`,buildReportEvidenceIndex(source)).ok).toBe(true);
 });
 it.each(["无法得出“安装问题最常见且预算必然阻止购买”的结论。", "无法得出安装问题最常见而且预算必然阻止购买的结论。"])("keeps coordinated predicates in one closed denied conclusion: %s", line => {
  expect(validateReportEvidence(`[服务端甲回答：支持电话。](#answer-1)\n\n${line}`,buildReportEvidenceIndex(source)).ok).toBe(true);
 });
 it.each(['无法得出"预算必然阻止购买"的无条件结论。', "无法得出「预算必然阻止购买」的无条件结论。"])("matches paired conclusion delimiters: %s", line => {
  expect(validateReportEvidence(`[服务端甲回答：支持电话。](#answer-1)\n\n${line}`,buildReportEvidenceIndex(source)).ok).toBe(true);
 });
 it.each(["无法得出‘预算必然阻止购买”的无条件结论。", "无法得出“预算必然阻止购买’的无条件结论。", "无法得出‘安装问题最常见’的结论且有人称“预算必然阻止购买”。"])("does not strip mismatched or nested independent assertions: %s", line => {
  expect(validateReportEvidence(`[服务端甲回答：支持电话。](#answer-1)\n\n${line}`,buildReportEvidenceIndex(source)).reason).toBe("unsupported_evidence_strength");
 });
 it("preserves byte-exact public prohibition on an unconditional conclusion", () => {
  const line = readFileSync(new URL("./fixtures/strength-conclusion-5346/report.md",import.meta.url),"utf8").split("\n")[48];
  if (line === undefined) throw new Error("Missing public raw line 49");
  expect(validateReportEvidence(`[服务端甲回答：支持电话。](#answer-1)\n\n${line}`,buildReportEvidenceIndex(source)).ok).toBe(true);
 });
 it.each(["无法得出“预算必然阻止购买”的无条件结论。", "无法得出‘预算必然阻止购买’的无条件结论。", "不得得出安装问题最常见的结论。"])("preserves local inability to conclude: %s", line => {
  expect(validateReportEvidence(`[服务端甲回答：支持电话。](#answer-1)\n\n${line}`,buildReportEvidenceIndex(source)).ok).toBe(true);
 });
 it.each(["无法得出预算充足的结论因此预算必然阻止购买的结论。", "无法得出安装顺利的结论所以安装问题最常见的结论。", "并非无法得出“预算必然阻止购买”的无条件结论。", "并非无法得出‘预算必然阻止购买’的无条件结论。", "不是不能得出安装问题最常见的结论。", "无法得出预算充足的结论，但预算必然阻止购买。", "无法得出预算结论，因此安装问题最常见。", "无法得出安装问题最常见的结论且预算必然阻止购买。", "无法得出‘安装问题最常见’的结论且预算必然阻止购买。"])("does not waive independent definite strength: %s", line => {
  expect(validateReportEvidence(`[服务端甲回答：支持电话。](#answer-1)\n\n${line}`,buildReportEvidenceIndex(source)).reason).toBe("unsupported_evidence_strength");
 });
 it.each([
  "不能把这2个任务说成只有单一问答，也不能将多个回答虚构为多专家共识。",
  "不应把单个回答虚构成两位专家的共识。",
  "不得将不同场景的回答虚构为跨角色共识。",
 ])("preserves a scoped denial of fabricated consensus: %s", claim => {
  expect(validateReportEvidence(`[服务端甲回答：支持电话。](#answer-1)\n\n${claim}`, buildReportEvidenceIndex(source)).ok).toBe(true);
 });
 it.each([
  "将多个回答虚构为多专家共识。",
  "不能把回答分开而要虚构为多专家共识。",
  "不能将回答拆开而是虚构为多专家共识。",
  "不能把回答分开而应宣称为多专家共识。",
  "不能不将多个回答虚构为多专家共识。",
  "不能否认多个回答形成多专家共识。",
  "不能将预算虚构为零，多专家共识已经形成。",
  "不能将多个回答虚构为多专家共识，但事实上跨角色共识已经形成。",
  "不能将多个回答虚构为多专家共识；多专家共识已经形成。",
  "不能将多个回答虚构为多专家共识;多专家共识已经形成。",
 ])("does not waive positive consensus with fabrication wording: %s", claim => {
  expect(validateReportEvidence(`[服务端甲回答：支持电话。](#answer-1)\n\n${claim}`, buildReportEvidenceIndex(source)).reason).toBe("unsupported_cross_expert_consensus");
 });

 it.each(["安装问题最常见。", "安装问题必然阻止采购。", "不能安装设备意味着安装问题最常见。", "不能断言安装问题不是最常见。", "不能声称安装问题不会必然阻止采购。"])("rejects finite unqualified strength claims despite valid exact quotes: %s", claim => {
  expect(validateReportEvidence(`[服务端甲回答：支持电话。](#answer-1)\n\n${claim}`,buildReportEvidenceIndex(source)).ok).toBe(false);
 });
 it.each(["不能断言安装问题最常见。", "不能声称安装问题必然阻止采购。", "若安装问题必然阻止采购，应重新验证这一假设。"])("preserves scoped qualifications: %s", claim => {
  expect(validateReportEvidence(`[服务端甲回答：支持电话。](#answer-1)\n\n${claim}`,buildReportEvidenceIndex(source)).ok).toBe(true);
 });
 it.each([
  "不能断言预算约束因而必然阻止购买。",
  "不能断言安装问题从而必然影响采购。",
  "不能断言安装问题进而必然影响采购。",
  "不能断言安装问题继而必然影响采购。",
  "不能断言安装问题既最常见而且必然阻止购买。",
 ])("keeps denial scope across internal causal conjunctions: %s", claim => {
  expect(validateReportEvidence(`[服务端甲回答：支持电话。](#answer-1)\n\n${claim}`,buildReportEvidenceIndex(source)).ok).toBe(true);
 });
 it.each([
  "不能凭空补充样本统计来断言预算约束必然阻止购买。",
  "不应编造统计来声称安装问题最常见。",
  "不得虚构样本统计来证明安装问题必然影响采购。",
 ])("preserves a direct prohibition on fabricating statistical support: %s", claim => {
  expect(validateReportEvidence(`[服务端甲回答：支持电话。](#answer-1)\n\n${claim}`,buildReportEvidenceIndex(source)).ok).toBe(true);
 });
 it.each([
  "不能凭空补充样本统计来断言预算约束而认为预算约束必然阻止购买。",
  "不能凭空补充样本统计来断言预算约束反而声称预算约束必然阻止购买。",
  "不能凭空补充样本统计来断言预算约束而须认定预算约束必然阻止购买。",
  "不能断言预算约束而认为预算约束必然阻止购买。",
  "不能凭空补充样本统计，预算约束必然阻止购买。",
  "不能凭空补充样本统计；预算约束必然阻止购买。",
  "不能凭空补充样本统计;预算约束必然阻止购买。",
  "不能凭空补充样本统计来断言预算，但预算约束必然阻止购买。",
  "不能凭空补充样本统计来断言预算而要说预算必然阻止购买。",
  "不能凭空补充样本统计来断言预算却认为预算必然阻止购买。",
  "不能不凭空补充样本统计来断言预算约束必然阻止购买。",
  "不能凭空补充样本统计来断言预算不会必然阻止购买。",
  "不能否认预算约束必然阻止购买。",
  "补充样本统计来断言预算约束必然阻止购买。",
  "不能断言预算约束因而必然阻止购买，然而预算约束必然阻止购买。",
  "不能断言安装问题最常见，而且必然阻止购买。",
  "不能断言安装问题最常见而且事实上必然阻止购买。",
 ])("does not waive an affirmative strength claim with an unrelated prohibition: %s", claim => {
  expect(validateReportEvidence(`[服务端甲回答：支持电话。](#answer-1)\n\n${claim}`,buildReportEvidenceIndex(source)).reason).toBe("unsupported_evidence_strength");
 });
 it("describes distinct bound server tasks without treating them as verified human identities", () => {
  const text = "支持电话。\n反对电话。";
  const index = buildReportEvidenceIndex({...source,markdown:text,contentHash:hash(text),answerSpans:[
   {taskKey:"revision/shared-a",expertId:"expert-a",start:0,end:5,contentHash:hash("支持电话。")},
   {taskKey:"revision/shared-b",expertId:"expert-b",start:6,end:text.length,contentHash:hash("反对电话。")},
  ]});
  const context = reportEvidenceContext(index);
  expect(context).toContain("服务端已绑定任务数：2；画像数：2");
  expect(context).toContain("归属已绑定不等于真人身份已验证");
  expect(context).toContain("revision不是任务");
 });
 it("does not duplicate every indexed quote in per-anchor syntax hints", () => {
  const index = buildReportEvidenceIndex(source);
  const context = reportEvidenceContext(index);
  expect(context).not.toContain("此条合法逐字引用：");
  for (const entry of index) { expect(context).toContain(entry.quote); expect(context).toContain(`引用定位：#${entry.anchor}`); }
 });
 it("provides complete escaped source examples and explicit invalid citation formats", () => {
  const quote = "公开合成回答：[安装] *冲突*。";
  const index = buildReportEvidenceIndex({...source,markdown:quote,contentHash:hash(quote),answerSpans:[{...source.answerSpans![0]!,end:quote.length,contentHash:hash(quote)}]});
  const context = reportEvidenceContext(index);
  const example = "[公开合成回答：\\[安装\\] \\*冲突\\*。](#answer-1)";
  expect(context).toContain(example);
  expect(validateReportEvidence(example,index).ok).toBe(true);
  for (const invalid of ["[answer-1](#answer-1)", `“${quote}”（[answer-1](#answer-1)）`, "[source-2](#expert-support)"]) {
   expect(context).toContain(invalid === `[source-2](#expert-support)` ? invalid : "[answer-1](#answer-1)");
   expect(validateReportEvidence(invalid,index).ok).toBe(false);
  }
  expect(context).toContain("taskKey是任务身份，不等于revisionId");
 });
 it.each(["原文：&amp;", "原文：&#65;", "原文：&#x41;"])("keeps literal HTML entities in legal citation examples: %s", quote => {
  const index = buildReportEvidenceIndex({...source, markdown:quote, contentHash:hash(quote), answerSpans:[{...source.answerSpans![0]!,end:quote.length,contentHash:hash(quote)}]});
  const context = reportEvidenceContext(index);
  const examples = context.split("\n").filter(line => line.startsWith("[") && line.endsWith("](#answer-1)"));
  expect(examples.length).toBeGreaterThan(0);
  for (const example of examples) expect(validateReportEvidence(example,index).ok).toBe(true);
 });
 it("does not promote model headings to server task identities; retains counterevidence and duplicate Q numbers", () => {
  const index = buildReportEvidenceIndex(source);
  expect(new Set(index.map(x=>x.expertId))).toEqual(new Set(["expert-a"]));
  expect(index.map(x=>x.quote).join("\n")).toBe(raw);
  expect(index[0]).toMatchObject({ sourceHash: hash(raw), documentId: "md-runs", version: 2, taskKey: "rev-a/expert-a" });
 });
 it("indexes legacy prefix, inter-span gaps and suffix without assigning them to new server tasks", () => {
  const prefix = "## [旧角色](#expert-legacy)\r\nQ2：反对电话，保留旧反例。🧪\r\n";
  const first = "Q2：新任务支持电话。";
  const gap = "\n旧记录补充：预算限制。\n";
  const second = "Q2：第二任务反对统一渠道。";
  const suffix = "\n旧尾部：无法形成共识。";
  const body = prefix + first + gap + second + suffix;
  const start2 = prefix.length + first.length + gap.length;
  const document = {...source,markdown:body,contentHash:hash(body),answerSpans:[
    {expertId:"a",taskKey:"rev/a",start:prefix.length,end:prefix.length+first.length,contentHash:hash(first)},
    {expertId:"b",taskKey:"rev/b",start:start2,end:start2+second.length,contentHash:hash(second)},
  ]};
  const index = buildReportEvidenceIndex(document);
  expect(index.map(entry=>entry.quote)).toEqual(["## [旧角色](#expert-legacy)","Q2：反对电话，保留旧反例。🧪",first,"旧记录补充：预算限制。",second,"旧尾部：无法形成共识。"]);
  for (const entry of index) {
    expect(body.slice(entry.start,entry.end)).toBe(entry.quote);
    expect(entry.sourceHash).toBe(hash(body));
    expect(entry.expertId).toBe(entry.quote===first?"a":entry.quote===second?"b":null);
    expect(entry.taskKey).toBe(entry.quote===first?"rev/a":entry.quote===second?"rev/b":null);
  }
  const legacy = index.find(entry=>entry.quote.includes("保留旧反例"))!;
  const cited = validateReportEvidence(`[${legacy.quote}](#${legacy.anchor})`,index);
  expect(cited.ok).toBe(true);
  expect(cited.references[0]?.locator).toMatchObject({quote:legacy.quote,expertId:null,taskKey:null});
 });
 it("rejects wrong attribution, fabricated quotes and document-only citations", () => {
  const index = buildReportEvidenceIndex(source);
  expect(validateReportEvidence("证据：[客服说支持电话](#answer-1)", index).ok).toBe(false);
  expect(validateReportEvidence("证据：[支持电话。](#answer-999)", index).ok).toBe(false);
  expect(validateReportEvidence("证据：[支持电话。](#source-1)", index).ok).toBe(false);
 });
 it("binds an exact quote to its unique position rather than a bare Q number", () => {
  const result = validateReportEvidence("证据：[Q2：厨房孔位冲突。](#answer-4)", buildReportEvidenceIndex(source));
  expect(result.ok).toBe(true);
  expect(result.references[0]?.locator).toMatchObject({ start: raw.indexOf("Q2：厨房孔位冲突。"), end: raw.length, expertId: "expert-a", taskKey: "rev-a/expert-a", quote: "Q2：厨房孔位冲突。", sourceHash: hash(raw) });
 });
 it("fails closed for stale hashes, invalid spans and partial quotes without exact locators", () => {
  expect(()=>buildReportEvidenceIndex({...source, contentHash: "a".repeat(64)})).toThrow();
  expect(()=>buildReportEvidenceIndex({...source, answerSpans: [{...source.answerSpans![0]!, end: raw.length+1}]})).toThrow();
  const repeated = "支持电话。支持电话。";
  const index = buildReportEvidenceIndex({...source, markdown: repeated, contentHash: hash(repeated), answerSpans:[{...source.answerSpans![0]!,end:repeated.length,contentHash:hash(repeated)}]});
  expect(validateReportEvidence("[支持电话。](#answer-1)",index).ok).toBe(false);
 });
 it("ignores citation-looking code and rejects mismatched attribution between distinct server tasks", () => {
  const body = "支持电话。\n反对电话。";
  const spans = [{taskKey:"rev/a",expertId:"a",start:0,end:5,contentHash:hash("支持电话。")},
    {taskKey:"rev/b",expertId:"b",start:6,end:11,contentHash:hash("反对电话。")}];
  const index = buildReportEvidenceIndex({...source,markdown:body,contentHash:hash(body),answerSpans:spans});
  expect(validateReportEvidence("[支持电话。](#answer-2)",index).ok).toBe(false);
  expect(validateReportEvidence("`[支持电话。](#answer-1)`",index).ok).toBe(false);
  expect(validateReportEvidence("[反对电话。](#answer-2)",index).references[0]?.locator).toMatchObject({expertId:"b",taskKey:"rev/b"});
  expect(validateReportEvidence("两位专家共同讨论电话：[支持电话。](#answer-1) 与 [反对电话。](#answer-2)",index).ok).toBe(true);
  expect(validateReportEvidence("[支持电话。](#answer-1) 与 [反对电话。](#answer-2)\n\n两位专家一致支持电话。",index).ok).toBe(false);
 });
 it("rejects unsupported positive cross-role consensus but preserves uncertainty and counterclaims", () => {
  const index = buildReportEvidenceIndex(source);
  expect(validateReportEvidence("[服务端甲回答：支持电话。](#answer-1)\n\n两位专家一致支持电话。",index).ok).toBe(false);
  expect(validateReportEvidence("[服务端甲回答：支持电话。](#answer-1)\n\n## 两位专家一致支持电话",index).ok).toBe(false);
  expect(validateReportEvidence("[服务端甲回答：支持电话。](#answer-1)\n\n| 结论 |\n| --- |\n| 两位专家一致支持电话 |",index).ok).toBe(false);
  expect(validateReportEvidence("[服务端甲回答：支持电话。](#answer-1)\n\n不能推断跨角色共识。",index).ok).toBe(true);
  expect(validateReportEvidence("[服务端甲回答：支持电话。](#answer-1)\n\n不同角色并非一致。",index).ok).toBe(true);
 });
 it.each(["不构成", "未构成", "不足以形成", "不足以构成"])("preserves the explicit %s consensus boundary", (negation) => {
  const report = `[服务端甲回答：支持电话。](#answer-1)\n\n上述材料来自单个服务端任务，${negation}跨角色共识；仅用于界面定位测试。`;
  expect(validateReportEvidence(report,buildReportEvidenceIndex(source)).ok).toBe(true);
 });
 it.each([
  "不能将这两个模拟角色的观点宣称为‘跨角色共识’。",
  "不能将两个分别关注预算限制以及具体安装任务的模拟角色的观点宣称为跨角色共识。",
  "本节不作肯定跨角色共识断言。",
  "不应将单个角色的证言断言为跨角色共识。",
  "不能作为真实用户行为或跨角色共识的依据。",
  "不可作为跨专家共识的依据。",
  "不同task下的回答不可合并宣称为跨专家的共识。",
  "不能将这些观点断言为跨角色共识。",
  "两位专家并非完全一致。", "两位专家不完全一致。", "两位专家未达成完全一致。",
  "不能将冷却定义为跨角色共识。",
 ])("preserves scoped negative consensus across long subjects: %s", (claim) => {
  expect(validateReportEvidence(`[服务端甲回答：支持电话。](#answer-1)\n\n${claim}`,buildReportEvidenceIndex(source)).ok).toBe(true);
 });
 it.each([
  "不能推断以前的结论，但两位专家一致支持电话。",
  "没有预算支持，然而跨角色共识已经形成。",
  "不能否认两位专家一致支持电话。",
  "并非没有跨角色共识。",
  "不能不形成跨角色共识。",
  "无法排除跨角色共识。",
  "团队否认不能将两个分别关注预算限制以及具体安装任务的模拟角色观点宣称为跨角色共识。",
  "两位专家共同支持电话。",
  "可作为真实用户行为或跨角色共识的依据。",
  "这些回答合并宣称为跨专家的共识。",
  "不能作为真实用户行为，但可作为跨角色共识的依据。",
  "并非不能作为跨专家共识的依据。",
  "并无不能作为跨专家共识的依据的理由。",
  "绝非不可合并宣称为跨专家共识。",
  "不能不合并宣称为跨专家的共识。",
  "不支持别人否定这些证据。跨专家共识已经形成。",
  "不能作为失败的依据。跨专家共识已经形成。",
  "不可合并分析；跨专家共识已经形成。",
  "不能作为跨专家共识。其依据已另行给出。",
  "不能作为采购结论的依据\n跨专家共识已经形成。",
 ])("does not waive positive, contrast or double-negative claims: %s", (claim) => {
  expect(validateReportEvidence(`[服务端甲回答：支持电话。](#answer-1)\n\n${claim}`,buildReportEvidenceIndex(source)).ok).toBe(false);
 });
 it("binds known explicit attribution to server metadata, including legacy and same-name ambiguity", () => {
  const labels = {"expert-a":"教师","expert-b":"校长"};
  const index = buildReportEvidenceIndex(source,labels);
  expect(validateReportEvidence("校长指出：[服务端甲回答：支持电话。](#answer-1)",index,labels).ok).toBe(false);
  expect(validateReportEvidence("教师指出：[服务端甲回答：支持电话。](#answer-1)",index,labels).ok).toBe(true);
  expect(validateReportEvidence("教师Q2：[服务端甲回答：支持电话。](#answer-1)",buildReportEvidenceIndex({...source,answerSpans:undefined}),labels).ok).toBe(false);
  expect(validateReportEvidence("教师指出：[服务端甲回答：支持电话。](#answer-1)",index,{"expert-a":"教师","expert-b":"教师"}).ok).toBe(false);
 });
 it("legacy content remains available but unassigned, and absent citations cannot pass", () => {
  const index = buildReportEvidenceIndex({...source, answerSpans: undefined});
  expect(index[0]).toMatchObject({ expertId:null, taskKey:null, quote:"服务端甲回答：支持电话。" });
  expect(validateReportEvidence("跨角色共同支持电话，无需原文。",index).ok).toBe(false);
 });
});

it.each(["教师和校长均表示", "教师、校长都认为", "教师与校长共同指出", "教师以及校长表示"])("rejects coordinated attribution without every named expert citation (%s)", (claim) => {
 const labels = {"expert-a":"教师", "expert-b":"校长"};
 const index = buildReportEvidenceIndex(source, labels);
 expect(validateReportEvidence(`${claim}：[服务端甲回答：支持电话。](#answer-1)`, index, labels).ok).toBe(false);
});

it.each([true,false])("does not infer question-answer count from indexed lines, headings or task spans (bound=%s)", bound => {
 const text="### 问题一\n回答一。\n### 问题二\n回答二。";
 const document={...source,markdown:text,contentHash:hash(text),answerSpans:bound?[{taskKey:"task-a",expertId:"expert-a",start:0,end:text.length,contentHash:hash(text)}]:[]};
 const index=buildReportEvidenceIndex(document);
 expect(index).toHaveLength(4);
 const context=reportEvidenceContext(index);
 expect(context).toContain("问答数量状态：不可确定");
 expect(context).toContain("当前源契约没有服务端逐问答身份");
 expect(context).toContain("报告省略问答数量");
 expect(context).not.toContain("服务端已确认问答数：4");
 expect(context).not.toContain("每个任务仅包含单次问答");
 expect(context).toContain(bound?"服务端已绑定任务数：1；画像数：1":"服务端已绑定任务数：0；画像数：0");
});
