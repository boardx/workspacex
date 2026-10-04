import { interviewMarkdown } from "@repo/contracts";
import type { ReportEvidence } from "./interview-report-grounding";
export type ReportClaimBoundaryGap = "unsupported_executed_measurement" | "unqualified_defect_exclusion" | "overbroad_physical_check_exemption";
type Count = {value: string; unit: string};
// This is a finite syntax boundary for observed counterexamples, NOT a semantic truth validator.
// Never mutate candidate bytes, infer source identity, or treat arbitrary nearby quotes as support.
const executed = /(?:本次|此次|这次|已(?:经)?)(?:.{0,16})(?:检测|测量|检查|发现|记录)|(?:检测|测量|检查)(?:.{0,8})(?:结果|发现)/u;
const count = /不兼容项(?:数量|数)?[^。；\n]{0,24}?(?<!不|非)(?:为|是|发现(?:了)?|记录(?:了)?|:)[：:\s]*([+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:e[+-]?\d+)?|[零〇一二两三四五六七八九十百千万]+))\s*(%|项|个)?/giu;
const clauses = (text: string) => text.normalize("NFKC").split(/[。；\n]|(?:但是|但|不过|然而|却)/u).filter(Boolean);
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
function observations(text: string): Count[] {
  return clauses(text).flatMap(clause => [...clause.matchAll(count)].flatMap(match => {
    const proposition = clause.slice(0, match.index! + match[0].length).split(/[，,]/u).at(-1)! + clause.slice(match.index! + match[0].length).split(/[，,]/u)[0]!;
    if (/[？?]|是否|(?:吗|么|呢)\s*$/u.test(proposition) || !executed.test(clause) || qualified(clause,match.index!,match.index!+match[0].length)) return [];
    const raw = match[1]!.toLowerCase().replaceAll(",", "");
    const small: Record<string,number> = {零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
    const numeric = small[raw] ?? (/^[零〇一二两三四五六七八九十百千万]+$/u.test(raw) ? chineseCount(raw) : Number(raw));
    return [{value: Number.isFinite(numeric) ? String(numeric) : raw, unit: match[2] === "%" ? "%" : "count"}];
  }));
}
export function assessReportClaimBoundaries(markdown: string, index: readonly ReportEvidence[]): {ok: boolean; missing: readonly ReportClaimBoundaryGap[]} {
  const missing = new Set<ReportClaimBoundaryGap>();
  const sourceByAnchor = new Map(index.map(entry => [`#${entry.anchor}`,entry]));
  for (const assertion of interviewMarkdown.parseInterviewReportAssertions(markdown, {groupTableRows:true})) {
    const claims = observations(assertion.text);
    const supported = assertion.links.flatMap(link => {
      const entry = sourceByAnchor.get(link.url);
      // Source must be a server-bound answer with an exact quote, not a prose-created role.
      return entry?.expertId && entry.taskKey && entry.quote === link.text ? observations(entry.quote) : [];
    });
    if (claims.some(claim => !supported.some(source => source.value === claim.value && source.unit === claim.unit)))
      missing.add("unsupported_executed_measurement");
    for (const clause of clauses(assertion.text)) {
      const exclusion = /(?:安装风险|安装问题|产品)(?:.{0,16}?)(?:不是|并非|没有|不存在|不含)(?:.{0,8}?)(?:产品固有缺陷|产品缺陷|固有缺陷|缺陷|产品问题)/u.exec(clause);
      if (exclusion && !qualified(clause,exclusion.index,exclusion.index+exclusion[0].length))
        missing.add("unqualified_defect_exclusion");
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
