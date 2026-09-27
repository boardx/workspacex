import type { survey } from '@repo/contracts';
import { surveyReportShareBlockedReason } from '@repo/contracts/survey-report';

/** A readable projection of the persisted compiled report, never a second editable model. */
export function surveyReportMarkdown(report: survey.CompiledSurveyReport): string {
  const lines = [`# ${report.title}`];
  if (report.sampleSummary) {
    const sample = report.sampleSummary;
    lines.push(`样本口径：总答卷 ${sample.total} · 待复核 ${sample.pendingReview} · 已排除 ${sample.excluded} · 纳入分析 ${sample.included}`);
  }
  for (const section of report.sections) {
    lines.push(`## ${section.title}`);
    for (const insight of section.analysis ?? []) lines.push(`### ${insight.title}`, insight.evidence, `建议行动：${insight.action}`);
    for (const block of section.blocks) {
      if (block.type === 'page-break') { lines.push('---'); continue; }
      lines.push(`### ${block.title}`);
      if (typeof block.sampleSize === 'number') lines.push(`实际样本量：${block.sampleSize}`);
      if (block.type === 'image' && block.imageUrl) lines.push(`![${(block.caption ?? block.title).replace(/[\[\]\\\n\r]/g,' ')}](${block.imageUrl.replace(/\(/g,'%28').replace(/\)/g,'%29')})`);
      if (block.text) lines.push(block.text);
      if (block.caption) lines.push(block.caption);
      for (const row of block.rows) lines.push(`- ${[row.label, row.group].filter(Boolean).join(' · ')}：${row.value ?? '无法计算'}（样本 ${row.count}）${row.target === undefined ? '' : `；目标 ${row.target}`} ${row.gap === undefined ? '' : `；差距 ${row.gap}`}`);
      for (const answer of block.answerTexts ?? []) lines.push(`- ${answer.label}：${answer.value}`);
      for (const issue of block.issues) lines.push(`> ${issue}`);
    }
  }
  return `${lines.join('\n\n')}\n`;
}

export function downloadReportMarkdown(report: survey.CompiledSurveyReport) {
  const blocked = surveyReportShareBlockedReason(report);
  if (blocked) throw new Error(blocked);
  const url = URL.createObjectURL(new Blob([surveyReportMarkdown(report)], {type:'text/markdown;charset=utf-8'}));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'survey-report.md'; document.body.appendChild(anchor);
  try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
