import { unified } from "unified";
import remarkParse from "remark-parse";
import { validateReportEvidence, type ReportEvidence } from "./interview-report-grounding";
import { assessReportClaimBoundaries } from "./interview-report-claim-boundaries";

/** Drop complete unsupported blocks, including their claims, rather than just erasing citations.
 * The caller must validate the resulting whole report before persisting it. */
export function pruneUnsupportedReportBlocks(markdown: string, evidence: readonly ReportEvidence[], labels: Readonly<Record<string, string>> = {}): string {
  const tree = unified().use(remarkParse).parse(markdown);
  const removals: Array<{ start: number; end: number }> = [];
  for (const node of tree.children) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    const block = markdown.slice(start, end);
    const grounding = validateReportEvidence(block, evidence, labels, { requireCitation: false });
    if (!grounding.ok || !assessReportClaimBoundaries(block, evidence).ok) {
      removals.push({ start, end });
    }
  }
  let result = markdown;
  for (const { start, end } of removals.reverse()) result = result.slice(0, start) + result.slice(end);
  return result.trim();
}
