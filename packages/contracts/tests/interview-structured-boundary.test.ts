import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {describe,it,expect} from "vitest";
import {assessInterviewReportAnalysis} from "../src/interview-markdown";
const lacksBoundary=(text:string)=>assessInterviewReportAnalysis(text).missing.includes("boundary_or_counterevidence");
describe("structured boundary recognition #5470",()=>{
 it("recognizes actual1m boundary dimension without asserting semantic quality or modifying bytes",()=>{
  const raw=readFileSync(new URL("./fixtures/structured-boundary-5470/actual1m-attempt1.md",import.meta.url),"utf8");
  expect(createHash("sha256").update(raw).digest("hex")).toBe("81012196a1fdd3618b6dbfd32bf692ce9efbbf157ada3b8e20192f68a4b016ac");
  expect(lacksBoundary(raw)).toBe(false);
 });
 it.each(["不确定性与限制","分歧与反例","2. 不确定性与限制"])("recognizes substantive section %s",heading=>{
  expect(lacksBoundary(`## ${heading}\n\n材料未提供型号与排查记录，不能判断发生率；需采集条件记录。`)).toBe(false);
 });
 it.each([
  "## 不确定性与限制",
  "## 不确定性与限制\n\n待补充。",
  "## 不确定性与限制\n\n改进产品体验。",
  "## 不确定性与限制\n\n## 下一步验证建议\n\n材料未提供条件，不能判断发生率。",
  "## 不确定性与限制\n\n> 材料未提供条件，不能判断发生率。",
  "## 不确定性与限制\n\n```md\n材料未提供条件，不能判断发生率。\n```",
  "## 不确定性与限制\n\n`材料未提供条件，不能判断发生率。`",
  "## 不确定性与限制\n\n[材料未提供条件，不能判断发生率。](#answer-7)",
  "## 讨论不确定性与限制\n\n材料未提供条件，不能判断发生率。",
  "只偶然提及不确定性与限制。材料未提供条件，不能判断发生率。",
 ])("does not accept empty or non-analysis boundary %s",text=>expect(lacksBoundary(text)).toBe(true));
});
