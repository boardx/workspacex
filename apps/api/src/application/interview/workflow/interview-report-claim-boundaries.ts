import { interviewMarkdown } from "@repo/contracts";
import type { ReportEvidence } from "./interview-report-grounding";
export type ReportClaimBoundaryGap = "unsupported_executed_measurement" | "unqualified_defect_exclusion" | "overbroad_physical_check_exemption" | "unsupported_current_decision_state" | "unsupported_physical_risk_downgrade";
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
function observations(text: string): Count[] {
  return clauses(text).flatMap(clause => [...clause.matchAll(count)].flatMap(match => {
    const proposition = clause.slice(0, match.index!).split(/[，,]/u).at(-1)! + match[0] + clause.slice(match.index! + match[0].length).split(/[，,]/u)[0]!;
    if (/[？?]|是否|(?:吗|么|呢)\s*$/u.test(proposition) || !executed.test(clause) || conditionalMeasurement(match[0]) || qualified(clause,match.index!,match.index!+match[0].length)) return [];
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
const currentDecisionState = /(?:当前|目前|现在)[^，,:：。；;\n]{0,20}?(?:采购|购买|投入)[^，,:：。；;\n]{0,12}?(?:搁置|暂停|暂缓|中断)(?:状态)?|(?:采购(?!者)|购买|投入)(?:决策|计划|流程)?[^，,:：。；;\n]{0,12}?(?:已经|已|仍|正在|处于)[^，,:：。；;\n]{0,6}?(?:搁置|暂停|暂缓|中断)(?:状态)?/gu;
// A bounded named role may intervene before its own state predicate. This does
// not exempt a budget proposition, unrelated clause or arbitrary preceding text.
const decisionSubject = String.raw`(?:[\p{L}·]{0,4}(?:采购者|受访者|用户|专家|研究员|经理|负责人))?`;
const decisionProhibition = new RegExp(String.raw`(?:不能|不可|无法|不得|不应)(?:据此)?(?:断言|声称|说明|表明|证明|确认|判断|认定)${decisionSubject}\s*$`, "u");
const deniedPrevention = new RegExp(String.raw`(?:不能|无法|不可|未能|没有|并未|不得|不应)(?:避免|防止)${decisionSubject}\s*$`, "u");
const decisionPrevention = new RegExp(String.raw`(?:避免|防止)${decisionSubject}\s*$`, "u");
function qualifiedDecisionState(clause: string, start: number, end: number): boolean {
  const before = clause.slice(0,start).split(/[，,:：]/u).at(-1)!;
  const predicate = clause.slice(start,end);
  const doubleDenial = /(?:并非|不是)\s*(?:没有|并未|未曾|从未|并不)/u.test(predicate);
  if (!doubleDenial && (/(?:是否|可能|或许|预计|将|拟|会|尚未|并未|并不|并非|不是|没有|未曾|从未)(?:已|已经|被|处于|将|会|\s)*(?:搁置|暂停|暂缓|中断)/u.test(predicate)
    || /^\s*(?:吗|么|呢|[？?])/u.test(clause.slice(end)))) return true;
  if (/不能不|不可不|不得不|否认|否定|而(?:要|应|是)|却/u.test(before)) return false;
  if (deniedPrevention.test(before)) return false;
  return decisionProhibition.test(before)
    || /不足以(?:说明|表明|证明|判断)\s*$/u.test(before)
    || decisionPrevention.test(before)
    || /^\s*(?:若|如果|假如)[^，,:：]{0,24}$/u.test(before);
}
const changedSetup = /移动(?:式)?(?:带线)?插座|移动电源|无固定柜体|免安装|桌面型/u;
const reducedPhysicalRisk = /(?:物理(?:冲突)?|供电|负荷|承重|线缆|空间|固定孔位(?:冲突)?)风险[^，,:：]{0,12}?(?:(?:自动|必然|已经|已)(?:得到)?)?(?:降级|降低|消除|消失)|(?:消除|降低|降级)(?:了)?[^，,:：]{0,12}?(?:供电|负荷|承重|线缆|空间|固定孔位(?:冲突)?)风险/gu;
function qualifiedRiskReduction(clause: string, start: number, end: number): boolean {
  const before = clause.slice(0,start).split(/[，,:：]/u).at(-1)!;
  const predicate = clause.slice(start,end);
  if (/(?:并非|不是)\s*(?:没有|尚未|并未|并不|不会|未)/u.test(predicate)) return false;
  if (/^\s*(?:吗|么|呢|[？?])/u.test(clause.slice(end))) return true;
  if (/(?:并非|不是|没有|尚未|并未|并不|不会|可能|是否)(?:自动|必然|已经|已)?(?:得到)?(?:降级|降低|消除|消失)/u.test(predicate)) return true;
  if (/不能不|不可不|不得不|否认|否定/u.test(before) || /(?:并非|不是)\s*(?:没有|尚未|并未|并不|不会|未)\s*$/u.test(before)) return false;
  if (/(?:并非|不是)(?:\s|说|真的|明确|直接|确实|完全|声称|表示){0,4}(?:不能|不可|无法|不得|不应)据此(?:断言|声称|确认|认定)\s*$/u.test(before)) return false;
  return /(?:可能|或许|并非|不是|并不|不会|尚未|并未|没有|未能|未)\s*$/u.test(before)
    || /(?:不能|不可|无法|不得|不应)据此(?:断言|声称|确认|认定)\s*$/u.test(before)
    || /^\s*(?:建议|拟|计划)(?:采用|改用)(?:移动(?:式)?(?:带线)?插座|移动电源|无固定柜体|免安装|桌面型)(?:以|来)?\s*$/u.test(before)
    || /(?:不能|不可|无法|不得|不应)(?:断言|声称|确认|认定)[^，,:：]{0,24}$/u.test(before)
    || /^\s*(?:若|如果|假如)[^，,:：]{0,24}(?:经|通过)[^，,:：]{0,16}(?:现场复核|负荷检测|安全检测|专项检测)确认[^，,:：]{0,12}$/u.test(before);
}
function scopedRecordedRisk(clause: string, quote: string, start: number, end: number): boolean {
  const observed = /本次对该[^，,:：]{1,24}的(?:现场复核|现场负荷检测|负荷检测|安全检测|专项检测)确认(?:该[^，,:：]{0,24})?(?:供电|负荷|承重|线缆|空间|固定孔位(?:冲突)?)风险已降低/u.exec(clause);
  return !!observed && start >= observed.index && end <= observed.index + observed[0].length
    && clauses(quote).some(source => source.trim() === observed[0]);
}
function decisionProposition(clause: string): string {
  // Remove neutral attribution outside the proposition, retaining speaker identity,
  // decision object, time and predicate. Do not reduce support to the state verb.
  // Keep trailing qualifications: a source hypothetical must not prove a present fact.
  return clause.trim()
    .replace(/^(?:根据|依据)(?:访谈|原文|记录|证据)[，,：:]\s*/u, "")
    .replace(/^(?:证据事实|已知事实|原文记录|(?:原文|访谈|记录|证据)(?:显示|表明|记载))[：:]\s*/u, "")
    .replace(/^([^，,:：]{1,24})(?:表示|称|说道)[：:]\s*/u, "$1");
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
    for (const clause of clauses(assertion.text)) {
      for (const state of clause.matchAll(currentDecisionState)) {
        if (qualifiedDecisionState(clause,state.index!,state.index!+state[0].length)) continue;
        const observed = assertion.links.some(link => {
          const entry = sourceByAnchor.get(link.url);
          if (!entry?.expertId || !entry.taskKey || entry.quote !== link.text) return false;
          // Preserve person/object/time together. Plans or observations from another
          // paragraph, person, decision or past window do not establish this state.
          return clauses(entry.quote).some(source => [...source.matchAll(currentDecisionState)].some(match =>
            !qualifiedDecisionState(source,match.index!,match.index!+match[0].length)
            && decisionProposition(source) === decisionProposition(clause)));
        });
        if (!observed) missing.add("unsupported_current_decision_state");
      }
    }
    const text = assertion.text.normalize("NFKC");
    const boundSetup = assertion.links.some(link => {
      const entry = sourceByAnchor.get(link.url);
      return entry?.expertId && entry.taskKey && entry.quote === link.text && changedSetup.test(entry.quote);
    });
    if (changedSetup.test(text) || boundSetup) {
      for (const clause of clauses(text)) {
        for (const risk of clause.matchAll(reducedPhysicalRisk)) {
          if (qualifiedRiskReduction(clause,risk.index!,risk.index!+risk[0].length)) continue;
          const observed = assertion.links.some(link => {
            const entry = sourceByAnchor.get(link.url);
            return !!entry?.expertId && !!entry.taskKey && entry.quote === link.text
              && scopedRecordedRisk(clause,entry.quote,risk.index!,risk.index!+risk[0].length);
          });
          if (!observed) missing.add("unsupported_physical_risk_downgrade");
        }
      }
    }
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
