import { interviewMarkdown } from "@repo/contracts";
import type { ReportEvidence } from "./interview-report-grounding";
export type ReportClaimBoundaryGap = "unsupported_executed_measurement" | "unqualified_defect_exclusion" | "overbroad_physical_check_exemption" | "unsupported_scenario_cause";
type Count = {value: string; unit: string};
// This is a finite syntax boundary for observed counterexamples, NOT a semantic truth validator.
// Never mutate candidate bytes, infer source identity, or treat arbitrary nearby quotes as support.
const executed = /(?:本次|此次|这次|已(?:经)?)(?:.{0,16})(?:检测|测量|检查|发现|记录)|(?:检测|测量|检查)(?:.{0,8})(?:结果|发现)/u;
const count = /不兼容项(?:数量|数)?[^。；\n]{0,24}?(?<!不|非)(?:为|是|发现(?:了)?|记录(?:了)?|:)[：:\s]*([+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:e[+-]?\d+)?|[零〇一二两三四五六七八九十百千万]+))\s*(%|项|个)?/giu;
const clauses = (text: string) => text.normalize("NFKC").split(/[。；;\n]|(?:但是|但|不过|然而|却)/u).filter(Boolean);
function qualified(clause: string, start: number, end: number): boolean {
  const prefix = clause.slice(0,start);
  const before = prefix.split(/[，,：:]/u).at(-1)!;
  // Inspect after the complete numeric token, so 1,000 remains one value rather than a clause boundary.
  const after = clause.slice(end).split(/[，,：:]/u)[0]!;
  const example = /^\s*(?:只是|仅是|属于|作为)(?:一个|一种)?(?:虚构|假想|假设)(?:的)?例子/u.test(after)
    || /(?:^|[，,:：])在(?:这个|该)?(?:虚构|假想|假设)(?:的)?例子中[，,:：]\s*(?:本次|此次|检测|测量|检查|结果|显示|发现|记录|的|中|\s)*$/u.test(prefix);
  // Negation and modality apply only within the current clause, not an earlier disclaimer.
  return /(?:(?:不能|不可|无法|不应|不宜|不得)(?:声称|说|断言|认为|说明|证明|得出|认定)?|不是说)\s*$/u.test(before)
    || /(?:若|如果|假如|未来|计划|拟|待验证|建议)(?:未来|本次|进行|执行|通过|检测|测量|检查|发现|记录|结果|中|的|将|会|\s)*$/u.test(before)
    || /(?:若|如果|假如)(?:[^，,:：]{0,24})(?:检测|测量|检查)(?:结果)?(?:显示|发现|记录)?\s*$/u.test(before)
    || example;
}
function chineseCount(raw: string): number {
  const digits: Record<string, number> = {零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  if (!/[十百千万]/u.test(raw)) return Number([...raw].map(char => digits[char]).join(""));
  const units: Record<string, number> = {十:10,百:100,千:1000,万:10000};
  let total = 0, section = 0, digit = 0;
  for (const char of raw) {
    if (char in digits) digit = digits[char]!;
    else if (char === "万") { total += (section + digit || 1) * 10000; section = 0; digit = 0; }
    else { section += (digit || 1) * units[char]!; digit = 0; }
  }
  return total + section + digit;
}
function conditionalMeasurement(proposition: string): boolean {
  // The condition must immediately qualify this count relation. An unrelated
  // conditional object (e.g. budget) or another clause cannot waive a measurement.
  return /^不兼容项(?:数量|数)?(?:在(?:本次|此次|这次)(?:检测|测量|检查)(?:中|时))?\s*(?:若|如果|假如)\s*(?:为|是|发现(?:了)?|记录(?:了)?|:)/u.test(proposition);
}
function observations(text: string, planned = false): Count[] {
  return clauses(text).flatMap(clause => [...clause.matchAll(count)].flatMap(match => {
    const proposition = clause.slice(0, match.index!).split(/[，,]/u).at(-1)! + match[0] + clause.slice(match.index! + match[0].length).split(/[，,]/u)[0]!;
    if ((planned && /^注意:\s*不兼容项为(?:零|〇|0)(?:项|个)?仅支持本次检测未发现冲突(?:,不能推翻一般安装风险)?$/u.test(clause.trim())) || /[？?]|是否|(?:吗|么|呢)\s*$/u.test(proposition) || !executed.test(clause) || conditionalMeasurement(match[0]) || qualified(clause,match.index!,match.index!+match[0].length)) return [];
    const raw = match[1]!.toLowerCase().replaceAll(",", "");
    const small: Record<string,number> = {零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
    const numeric = small[raw] ?? (/^[零〇一二两三四五六七八九十百千万]+$/u.test(raw) ? chineseCount(raw) : Number(raw));
    return [{value: Number.isFinite(numeric) ? String(numeric) : raw, unit: match[2] === "%" ? "%" : "count"}];
  }));
}
const defectExclusion = /(?:安装风险|安装问题|产品)(?:.{0,16}?)(?:不是|并非|没有|不存在|不含|并无|无)(?:.{0,8}?)(?:产品固有缺陷|产品缺陷|固有缺陷|缺陷|产品问题)|(?:而非|并非|不是|没有|不存在|不含|并无|无|排除(?:了)?)(?:[^，,:：]{0,16}?)(?:固有缺陷|设计缺陷|产品缺陷)/gu;
function qualifiedDefectExclusion(clause: string, start: number, end: number): boolean {
  const before = clause.slice(0,start).split(/[，,:：]/u).at(-1)!;
  const predicate = clause.slice(start,end);
  // Denying the absence of defects is not a positive defect exclusion.
  if (/(?:并非|不是)\s*(?:不存在|没有|不含|并无|无)/u.test(predicate)) return true;
  if (/否认|否定|不是(?!说)|并非|不会|不可能|不能不|不可不|不得不|而(?:要|应|是)|却/u.test(before)) return false;
  if (/^(?:安装风险|安装问题|产品)?(?:没有|无)证据排除/u.test(predicate)) return true;
  if (/^排除(?:了)?/u.test(predicate) && /(?:尚未|未能|没有证据)\s*$/u.test(before)) return true;
  return qualified(clause,start,end)
    || /(?:不能|不可|无法|不应|不宜|不得)(?:断言|声称|认为|说明|证明|认定)[^，,:：]{0,16}$/u.test(before)
    || /^\s*(?:若|如果|假如)[^，,:：]{0,64}$/u.test(before);
}
function scopedObservedExclusion(clause: string, quote: string, start: number, end: number): boolean {
  // A finite observed-method form, not a truth certificate. Preserve the same
  // inspected component, method and result; never extrapolate to the whole product.
  const inspected = /^\s*(?:本次|此次)对(该[^，,:：]{1,24}?(?:模块|部件|接口|回路))(?:拆机检测|故障复现排查|逐项检测|专项检测)(?:已)?(?:确认|查明)\1(?:不存在|没有)(?:[^，,:：]{0,8})(?:设计缺陷|固有缺陷)/u;
  const observed = inspected.exec(clause);
  return !!observed && start >= observed.index && end <= observed.index + observed[0].length
    && clauses(quote).some(source => source.trim() === clause.trim());
}
// Finite installation-scene causal forms observed in #5371, not general causal inference.
const scenarioCause = /(?:不同物理环境(?:\([^。；;\n]{0,32}\))?|(?:厨房|办公室|装修)?布局(?:差异|不同))\s*(可能|或许|也许)?\s*(?:(?:并非|不是)(?:没有|不)|不可能不)?(?:带来(?:的)?|导致|造成|引起|决定)(?:[^，,:：。；;\n]{0,16})(?:情境异质性|安装(?:结果)?差异|安装成功|安装失败)|安装(?:结果)?差异(?:由|是由)(?:厨房|办公室|装修)?布局(?:差异|不同)(可能|或许|也许)?(?:造成|导致|引起|决定)/gu;
const causalConfirmationConnector = String.raw`(?:了|的)?(?:(?:确实|的确|明确|直接|完全|真的|\s)*|[^，,:：。；;\n]*是)\s*$`;
const confirmedScenarioCause = new RegExp(String.raw`(?:确认|确定|证实|证明)` + causalConfirmationConnector, "u");
const deniedScenarioCause = new RegExp(String.raw`(?:不能|不可|无法|不得|不应)(?:断言|声称|确认|认定|证明|证实)` + causalConfirmationConnector, "u");
function qualifiedScenarioCause(clause: string, match: RegExpMatchArray): boolean {
  const before = clause.slice(0, match.index!).split(/[，,:：]/u).at(-1)!;
  // Modality must qualify this causal relation, not another object or sentence.
  const after = clause.slice(match.index! + match[0].length).split(/[，,:：]/u)[0]!;
  if (/^\s*(?:吗|么|呢)?[？?]\s*$/u.test(after)) return true;
  if (match[1] || match[2]) return true;
  if (/(?:否认|否定|不能不|不得不|不会不|(?:并非|不是)\s*(?:不能|不可|无法|不得|不应|并非|不是))/u.test(before)) return false;
  const negatives = before.match(/并非|不是/gu) ?? [];
  if (negatives.length) {
    const inner = before.search(/(?:并非|不是)\s*$/u);
    const outer = inner < 0 ? before : before.slice(0, inner);
    const prohibitedDenial = /(?:(?:不能|不可|无法|不得|不应)(?:说|断言|声称|确认|认定|证明)|(?:不可能|不会|无法|不能))(?:完全|明确|直接|确实|真的|绝对|这|该|\s)*$/u.test(outer);
    return !prohibitedDenial && negatives.length === 1 && inner >= 0;
  }
  // A postfix qualifier must describe this relation and end locally; unrelated
  // objects or another causal assertion cannot borrow its uncertainty.
  const suffix = clause.slice(match.index! + match[0].length).trim();
  const innerAffirmative = /(?:(?:并非|不是)(?:没有|不)|不可能不)(?:带来|导致|造成|引起|决定)/u.test(match[0]);
  // Copular 是 binds the following causal proposition even when modifiers intervene.
  // The comma-local prefix prevents confirmation of an earlier independent object
  // from being treated as confirmation of this cause.
  const confirmed = confirmedScenarioCause.test(before);
  if (!innerAffirmative && !confirmed && /^(?:这一假设|[,，]\s*原因)(?:尚待验证|尚待核实|有待验证|有待核实)\s*$/u.test(suffix)) return true;
  return deniedScenarioCause.test(before)
    || /(?:若|如果|假如|假设|可能|或许|也许)\s*$/u.test(before);
}
function scopedObservedScenarioCause(clause: string, quote: string): boolean {
  // Exact source-bound, explicitly observed comparison; opinion/heterogeneity alone
  // is insufficient. No alias, object, time or method is inferred from a nearby quote.
  return /^\s*本次对这两个安装场景逐项对照检测确认(?:厨房|办公室|装修)?布局(?:差异|不同)(?:导致|造成|引起)安装结果差异\s*$/u.test(clause)
    && clauses(quote).some(source => source.trim() === clause.trim());
}
export function assessReportClaimBoundaries(markdown: string, index: readonly ReportEvidence[]): {ok: boolean; missing: readonly ReportClaimBoundaryGap[]} {
  const missing = new Set<ReportClaimBoundaryGap>();
  const sourceByAnchor = new Map(index.map(entry => [`#${entry.anchor}`,entry]));
  // Only a plain future-plan introduction and the immediately following method row
  // qualify this finite interpretation. Headings and arbitrary plan wrappers do not.
  const intro = "以下建议均为待验证的行动方案,需在获取真人证据后方可执行:";
  const plannedRows = new Set(interviewMarkdown.parseInterviewReportAdjacentTableRows(markdown, intro));
  const assertions = interviewMarkdown.parseInterviewReportAssertions(markdown, {groupTableRows:true});
  for (const assertion of assertions) {
    const local = assertion.text.normalize("NFKC");
    const note = local.indexOf("注意:");
    const planned = plannedRows.has(local) && assertions.filter(row => row.text.normalize("NFKC") === local).length === 1 && note >= 0
      && /方法:实地测绘。指标:记录不兼容项数量。注意:/u.test(local)
      && !executed.test(local.slice(0, note));
    const claims = observations(assertion.text, planned);
    const supported = assertion.links.flatMap(link => {
      const entry = sourceByAnchor.get(link.url);
      // Source must be a server-bound answer with an exact quote, not a prose-created role.
      return entry?.expertId && entry.taskKey && entry.quote === link.text ? observations(entry.quote) : [];
    });
    if (claims.some(claim => !supported.some(source => source.value === claim.value && source.unit === claim.unit)))
      missing.add("unsupported_executed_measurement");
    for (const clause of clauses(assertion.text)) {
      for (const cause of clause.matchAll(scenarioCause)) {
        const boundProof = assertion.links.some(link => {
          const entry = sourceByAnchor.get(link.url);
          return entry?.expertId && entry.taskKey && entry.quote === link.text
            && scopedObservedScenarioCause(clause, entry.quote);
        });
        if (!qualifiedScenarioCause(clause, cause) && !boundProof) missing.add("unsupported_scenario_cause");
      }
      for (const exclusion of clause.matchAll(defectExclusion)) {
        const boundProof = assertion.links.some(link => {
          const entry = sourceByAnchor.get(link.url);
          return entry?.expertId && entry.taskKey && entry.quote === link.text
            && scopedObservedExclusion(clause,entry.quote,exclusion.index!,exclusion.index!+exclusion[0].length);
        });
        if (!qualifiedDefectExclusion(clause,exclusion.index!,exclusion.index!+exclusion[0].length) && !boundProof)
          missing.add("unqualified_defect_exclusion");
      }
    }
    const text = assertion.text.normalize("NFKC");
    const denial = /(?:(?:不能|不可|无法|不得)(?:说|断言|声称|认为)|不是说)(?:[^，,:：]{0,24})$/u;
    const whole = clauses(text).some(clause => {
      const match = /(?:整套|全部|整个)(?:.{0,12})(?:物理勘测|现场勘测|现场检查)(?:.{0,12})(?:无用|失效|不必要|无需)/u.exec(clause);
      if (!match) return false;
      const before = clause.slice(0,match.index).split(/[，,:：]/u).at(-1)!;
      const outerNegative = denial.test(before);
      const innerNegative = /(?:并非|不是|并不|没有)(?:完全|全部)?(?:无用|失效|不必要|无需)/u.test(match[0])
        || /(?:并非|不是|并不|没有)\s*$/u.test(before);
      // One negation denies the exemption; two do not establish that denial.
      return outerNegative === innerNegative;
    });
    const referred = /(?:物理勘测|现场勘测|现场检查)/u.test(text) && /(?:插座|供电|承重|空间)/u.test(text)
      && !/(?:仅|只)(?:[^，,。；]{0,8})(?:固定孔位|孔位|孔洞)(?:[^，,。；]{0,8})(?:此步骤|该步骤)/u.test(text)
      && /(?:免安装|桌面型)(?:.{0,40})(?:此步骤|该步骤|整个步骤)[，,\s]*(?:完全|全部|就|将)?(?:失效|无用|无需)/u.test(text);
    // A conditional device choice cannot waive all site/supply/load checks. Narrow hole checks remain allowed.
    if (whole || referred) missing.add("overbroad_physical_check_exemption");
  }
  return {ok: missing.size === 0, missing: [...missing]};
}
