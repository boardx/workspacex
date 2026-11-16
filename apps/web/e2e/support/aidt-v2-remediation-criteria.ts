/** QA content checks for this synthetic, native seven-task remediation.
 * These are bounded regression gates, not a substitute for a teacher's review. */
export const AIDT_REMEDIATION_MARKER = "native-seven-no-bridge-20261117";
export function isAidtRemediation(): boolean {
  const value = process.env.AIDT_V2_REMEDIATION;
  if (value === undefined) return false;
  if (value !== AIDT_REMEDIATION_MARKER) throw new Error("AIDT_REMEDIATION_EXACT_MARKER_REQUIRED");
  return true;
}
export type ContentCheck = { passed: boolean; failures: string[]; humanTeachingReview: "required" };
const result = (failures: string[]): ContentCheck => ({ passed: failures.length === 0, failures, humanTeachingReview: "required" });

/** Inspect affirmative clauses; negated prohibitions must not trigger the forbidden-claim gate. */
function affirmativeClauses(text: string): string[] {
  return text.split(/[。！!；;\n]|但是|然而|不过|但|却/u).filter(clause => !/(?:不能|不得|不可|不应|不要|并非|不等于|没有|尚无|未曾|未开展|尚未|不代表|不是|勿|不将|不把)/u.test(clause));
}
export function evaluateAidtStageReply(step: number, text: string): ContentCheck {
  const failures: string[] = [];
  const compact = text.trim();
  if (compact.length < 18 || !/[?？]/u.test(compact)) failures.push("SUBSTANTIVE_STUDENT_QUESTION_REQUIRED");
  if ((compact.match(/[?？]/gu) ?? []).length > 1) failures.push("ONE_FOCUSED_QUESTION_REQUIRED");
  const topic: Record<number, RegExp> = {
    1: /来源|依据|猜测|观察|抱怨|为什么|值得|取餐|提示/u,
    2: /访谈|采访|真实|真人|具体经历|原话|研究|材料/u,
    3: /画像|暂无|未知|证据|材料|发现|HMW|如何|差异/u,
    4: /点子|分类|创意|突破|有趣|实现|HMW|选择/u,
    5: /验证|最想|静态|原型|理解|取餐|问题/u,
    6: /测试|认识|证据|材料|回到|返回|原型|真实/u,
  };
  if (!topic[step]?.test(compact)) failures.push("CURRENT_STAGE_MATERIAL_OR_PURPOSE_REQUIRED");
  for (const clause of affirmativeClauses(compact)) {
    if (/(?:已经|已|我们已|自动).{0,8}(?:替你|为你|帮你|代表小组)?.{0,5}(?:确认(?:了)?(?:最终|阶段|结论|研究方向|画像|问题)|保存(?:了)?(?:成果|阶段|结论)|选定(?:了)?最佳)/u.test(clause)) failures.push("AGENT_MUST_NOT_CONFIRM_OR_SAVE_FOR_STUDENTS");
    if (/(?:已证实|已经证明|测试通过|获得(?:了)?用户认可|所有(?:新同学|用户|学生)都)/u.test(clause)) failures.push("SYNTHETIC_INPUT_MUST_NOT_BECOME_VERIFIED_FACT");
    if (step === 2 && /(?:代替|替代|取代).{0,8}(?:真实|真人|实地).{0,4}(?:采访|访谈|研究)/u.test(clause)) failures.push("SIMULATION_MUST_NOT_REPLACE_REAL_INTERVIEW");
    if (step === 3 && /(?:年龄(?:为|是|：|:)?\s*\d+|\d+岁|喜欢(?:游戏|运动)|生活方式是)/u.test(clause)) failures.push("UNKNOWN_PERSONA_FIELDS_MUST_NOT_BE_INVENTED");
    if (step === 3 && /(?:必须|需要|务必).{0,12}(?:编|补充|找出|生成).{0,8}意外发现/u.test(clause)) failures.push("NONE_IS_A_VALID_SURPRISE_RESPONSE");
  }
  return result([...new Set(failures)]);
}
export type SummaryCriteria = {
  truncated: boolean;
  hasV2: boolean;
  historicalReturnStep?: number;
  currentReturnStep?: number;
};
export function evaluateAidtSummary(text: string, scope: SummaryCriteria): ContentCheck {
  const failures: string[] = [];
  const required: [string, RegExp][] = [
    ["INITIAL_REASON_AND_SOURCE_REQUIRED", /选题|问题来源|最初.{0,12}(?:猜测|依据|理由)|原始.{0,12}(?:依据|猜测|命题)/u],
    ["SURPRISE_NONE_OR_EVIDENCE_REQUIRED", /意外|暂无|反例|矛盾/u],
    ["PERSONA_AND_HMW_REQUIRED", /画像|HMW|我们如何/u],
    ["STUDENT_IDEA_CLASSIFICATION_REQUIRED", /分类|容易实现|突破性|有趣/u],
    ["VERIFICATION_QUESTION_AND_LEARNING_REQUIRED", /验证问题|验证目标|认识.{0,8}(?:变化|未改变)|测试前后/u],
    ["SYNTHETIC_AND_MISSING_RESEARCH_DISCLOSURE_REQUIRED", /(?:尚无|没有|未开展|尚未).{0,12}(?:真人|真实).{0,8}(?:访谈|研究|测试)|合成.{0,12}(?:不代表|不是|不能)/u],
    ["TEACHER_COMMENT_ABSENCE_REQUIRED", /(?:无|没有|缺少|尚无|未提供|未包含).{0,20}教师点评|教师点评.{0,12}(?:无|缺失|未提供)/u],
  ];
  for (const [failure, pattern] of required) if (!pattern.test(text)) failures.push(failure);
  if (scope.hasV2 && !/(?:原型.{0,20}(?:V2|第二版|第2版)|(?:V2|第二版|第2版).{0,25}(?:原型|待测|待测试|合成))/iu.test(text)) failures.push("VISIBLE_SAVED_V2_MUST_BE_REPORTED");
  const stepMention = (step: number) => new RegExp(`(?:回到|返回|回|重返|重做|重新从|选择从).{0,12}(?:第?\\s*${step}\\s*步|第${["", "一", "二", "三", "四", "五", "六"][step]}步|${step === 2 ? "共情" : step === 5 ? "原型" : "第" + step + "阶段"})`, "u");
  if (scope.historicalReturnStep !== undefined && !stepMention(scope.historicalReturnStep).test(text)) failures.push("HISTORICAL_STUDENT_RETURN_DECISION_REQUIRED");
  if (scope.currentReturnStep !== undefined && !stepMention(scope.currentReturnStep).test(text)) failures.push("CURRENT_STUDENT_RETURN_DECISION_REQUIRED");
  if (scope.truncated && !/截断|节选|未完整|仅.{0,8}(?:可见|摘录)|可见范围|裁剪/u.test(text)) failures.push("TRUNCATED_MODEL_SCOPE_MUST_BE_DISCLOSED");
  for (const clause of affirmativeClauses(text)) if (/完整(?:读取|覆盖|分析)|所有材料.{0,6}(?:已|均).{0,8}(?:阅读|分析)|测试通过|已获用户认可/u.test(clause)) failures.push("NO_UNSUPPORTED_COMPLETENESS_OR_TEST_SUCCESS");
  return result([...new Set(failures)]);
}
