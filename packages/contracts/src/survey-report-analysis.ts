import type { CompiledSurveyBlock } from './survey-report';
import type { SurveyWorkflowQuestion } from './survey';

export type SurveySectionInsight = { title: string; evidence: string; action: string; blockIds: string[] };
const number = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
const scope = (count: number) => count === 1 ? '该题仅有 1 份有效作答，反映该受访者的反馈。' : `该项基于 ${count} 份有效作答。`;

/** Interpret only published aggregates: never read hidden groups or raw responses. */
export function analyzeSurveySection(blocks: CompiledSurveyBlock[], questions: SurveyWorkflowQuestion[]): SurveySectionInsight[] {
  const insights: SurveySectionInsight[] = [];
  const usable = blocks.filter(b => !b.issues.length && b.rows.length && !b.groupByQuestionId && b.type !== 'line');
  // A shared numeric domain permits a descriptive comparison, not a value judgment.
  const scales = new Map<string, { block: CompiledSurveyBlock; label: string; value: number; count: number }[]>();
  for (const block of usable) {
    if (block.statistic !== 'mean' || block.questionIds.length !== 1 || block.rows.length !== 1) continue;
    const question = questions.find(q => q.id === block.questionIds[0]);
    if (!question || question.type !== 'scale') continue;
    const domain = question.options.map(Number).sort((a,b)=>a-b);
    if (!domain.length || domain.some(v=>!Number.isFinite(v))) continue;
    const key = JSON.stringify(domain);
    scales.set(key, [...(scales.get(key) ?? []), { block, ...block.rows[0]! }]);
  }
  const summarized = new Set<string>();
  for (const [domain, rows] of scales) {
    if (rows.length < 2) continue;
    const ordered = [...rows].sort((a,b)=>a.value-b.value);
    const low=ordered[0]!, high=ordered[ordered.length-1]!;
    const distinct=low.value!==high.value;
    insights.push({
      title: distinct ? `本章评分跨度为 ${number(high.value-low.value)} 分，需核对体验差异` : `本章 ${rows.length} 项评分均为 ${number(low.value)}`,
      evidence: `${(distinct ? [low, high] : rows).map(r=>`“${r.label}”为 ${number(r.value)}（有效作答 ${r.count} 份）`).join('；')}。共同取值为 ${JSON.parse(domain).join('、')}。${rows.every(r=>r.count===1) ? '每项仅有 1 份有效作答，仅反映受访者反馈，不能代表整个组织。' : '各题样本分别统计，不据此推断因果或组织整体水平。'}`,
      action: distinct ? `围绕“${low.label}”与“${high.label}”分别补充最近一次实际经历，核对评分差异的原因，再确定需要改善的环节；评分高低本身不等于好坏。` : '结合各题的具体经历核对评分含义，再决定是否需要行动。',
      blockIds: rows.map(r=>r.block.id),
    });
    rows.forEach(r=>summarized.add(r.block.id));
  }
  for (const block of usable) {
    if (summarized.has(block.id)) continue;
    if (block.statistic === 'mean_rank') {
      const ordered=[...block.rows].sort((a,b)=>a.value-b.value);
      insights.push({title:'作答排序给出的优先关注顺序', evidence:ordered.map(r=>`“${r.label}”：平均名次 ${number(r.value)}，有效作答 ${r.count} 份`).join('；')+'。名次越小表示排序越靠前；并列项保持并列。', action:`先与受访者核对“${ordered[0]!.label}”的具体需求和预期结果，再结合成本与可行性确定行动顺序；作答排序不等于最终实施优先级。`,blockIds:[block.id]});
    } else if (['distribution','percentage'].includes(block.statistic)) {
      const selected=block.rows.filter(r=>r.count>0);
      if (!selected.length) continue;
      insights.push({title:`${block.title}：实际选择情况`,evidence:selected.map(r=>`“${r.label}”有 ${r.count} 份选择${block.statistic==='percentage'?`（${number(r.value)}%）`:''}`).join('；')+'。统计仅描述本次作答。',action:`围绕“${block.title}”核对选择背后的具体原因，并结合其他题目反馈确定是否需要跟进。`,blockIds:[block.id]});
    } else if (block.statistic === 'mean' && block.rows.length === 1) {
      const row=block.rows[0]!;
      insights.push({title:`${block.title}：作答结果`, evidence:`“${row.label}”的均值为 ${number(row.value)}。${scope(row.count)}${row.target===undefined?'未配置目标基准，不判定达标或不达标。':`模板目标为 ${number(row.target)}，目标减当前值为 ${number(row.gap!)}。`}`,action:`请受访者针对“${row.label}”补充一个具体实例及期望变化，作为后续改进依据。`,blockIds:[block.id]});
    }
  }
  for (const block of blocks.filter(b => !b.issues.length && !b.groupByQuestionId && b.answerTexts?.length && b.questionIds.every(id => questions.find(q => q.id === id)?.type === 'open'))) {
    const answers = block.answerTexts!;
    insights.push({
      title: `${block.title}：受访者提出的具体反馈`,
      evidence: answers.map(a => `“${a.value}”`).join('；') + '。以上为受访者原话，尚不能据此判断原因或发生频率。',
      action: '结合这些反馈核对涉及的具体场景、影响及期望结果，将可核实的问题转为待办；含义不清的回答先澄清。',
      blockIds: [block.id],
    });
  }
  return insights;
}
