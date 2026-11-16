import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { AIDT_REMEDIATION_MARKER, evaluateAidtStageReply, evaluateAidtSummary, isAidtRemediation } from "../e2e/support/aidt-v2-remediation-criteria";
const original = process.env.AIDT_V2_REMEDIATION;
afterEach(() => { if (original === undefined) delete process.env.AIDT_V2_REMEDIATION; else process.env.AIDT_V2_REMEDIATION = original; });
it("requires an exact opt-in rather than silently rewriting old evidence semantics", () => {
  delete process.env.AIDT_V2_REMEDIATION; expect(isAidtRemediation()).toBe(false);
  process.env.AIDT_V2_REMEDIATION = "1"; expect(() => isAidtRemediation()).toThrow("EXACT_MARKER");
  process.env.AIDT_V2_REMEDIATION = AIDT_REMEDIATION_MARKER; expect(isAidtRemediation()).toBe(true);
});
it("rejects the actual S2 replacement suggestion while allowing a clear prohibition", () => {
  expect(evaluateAidtStageReply(2, "你们能用什么方式来代替真实采访，以了解目标用户的感受与需求？").failures).toContain("SIMULATION_MUST_NOT_REPLACE_REAL_INTERVIEW");
  expect(evaluateAidtStageReply(2, "模拟不能代替真实访谈。接下来如何征求同意，请对方讲一次具体经历？").passed).toBe(true);
  expect(evaluateAidtStageReply(2, "什么？").passed).toBe(false);
  expect(evaluateAidtStageReply(2, "模拟不能替代真实访谈，但我们已经证实所有用户都困惑，你们想补什么材料？").passed).toBe(false);
  expect(evaluateAidtStageReply(2, "你们已经证实所有用户都困惑，下一步怎样保存研究结论？").passed).toBe(false);
});
it("keeps unknowns and 暂无 valid, detects invention and forced surprise", () => {
  expect(evaluateAidtStageReply(3, "意外发现可以填暂无，年龄仍未知；你们会怎样让画像保留材料里的差异？").passed).toBe(true);
  expect(evaluateAidtStageReply(3, "画像年龄为20岁，喜欢游戏；你们还想补什么材料？").failures).toContain("UNKNOWN_PERSONA_FIELDS_MUST_NOT_BE_INVENTED");
  expect(evaluateAidtStageReply(3, "你们必须补充一条意外发现才能继续画像，这条应该是什么？").failures).toContain("NONE_IS_A_VALID_SURPRISE_RESPONSE");
});
const honest = "原始命题来自学生猜测，选题依据未验证；意外发现暂无，画像和HMW仍为假设。学生分类点子。验证问题关注提示理解，测试前后认识未改变。没有真实访谈、测试，没有教师点评。历史选择返回第2步补访，当前选择回第五步修改原型。原型V2是合成静态方案，待测试。材料节选存在截断，不能宣称完整读取。";
it("requires visible V2, independent return decisions and an honest reading scope", () => {
  const scope = { truncated: true, hasV2: true, historicalReturnStep: 2, currentReturnStep: 5 };
  expect(evaluateAidtSummary(honest, scope).passed).toBe(true);
  expect(evaluateAidtSummary(honest.replace("原型V2是合成静态方案，待测试。", ""), scope).failures).toContain("VISIBLE_SAVED_V2_MUST_BE_REPORTED");
  expect(evaluateAidtSummary(honest.replace("历史选择返回第2步补访，", ""), scope).failures).toContain("HISTORICAL_STUDENT_RETURN_DECISION_REQUIRED");
  expect(evaluateAidtSummary(honest.replace("材料节选存在截断，不能宣称完整读取。", "已完整读取所有材料。"), scope).failures).toEqual(expect.arrayContaining(["TRUNCATED_MODEL_SCOPE_MUST_BE_DISCLOSED", "NO_UNSUPPORTED_COMPLETENESS_OR_TEST_SUCCESS"]));
});
it("does not invent V2 or a prior return decision when that scenario has no such saved source", () => {
  expect(evaluateAidtSummary(honest.replace("原型V2是合成静态方案，待测试。", "").replace("历史选择返回第2步补访，", ""), { truncated: false, hasV2: false, currentReturnStep: 5 }).passed).toBe(true);
});

it("catches the preserved real S2 and SUM failures without rewriting their evidence", () => {
  const folder = new URL("../../../docs/evidence/aidt-native/completion-20261116/a6/fresh-journey-20261117/", import.meta.url);
  const read = (filename: string) => JSON.parse(readFileSync(new URL(filename, folder), "utf8")) as { assistantText: string };
  expect(evaluateAidtStageReply(2, read("s2-actual-turn.json").assistantText).failures).toContain("SIMULATION_MUST_NOT_REPLACE_REAL_INTERVIEW");
  expect(evaluateAidtStageReply(3, read("s3-actual-turn.json").assistantText).passed).toBe(true);
  const oldSummary = evaluateAidtSummary(read("sum-actual-turn.json").assistantText, { truncated: true, hasV2: true, historicalReturnStep: 2, currentReturnStep: 5 });
  expect(oldSummary.failures).toEqual(expect.arrayContaining(["VISIBLE_SAVED_V2_MUST_BE_REPORTED", "HISTORICAL_STUDENT_RETURN_DECISION_REQUIRED", "TRUNCATED_MODEL_SCOPE_MUST_BE_DISCLOSED"]));
});
