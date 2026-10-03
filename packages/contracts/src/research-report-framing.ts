/** Report prose follows the confirmed topic; technical names do not change its language. */
export function guidedResearchReportFraming(brief: { topic: string; goal: string; focus: string }) {
  const chinese = /\p{Script=Han}/u.test(brief.topic + brief.goal + brief.focus);
  const topic = brief.topic.trim();
  const named = (suffix: string) => `${topic.slice(0, 200 - suffix.length)}${suffix}`;
  return chinese ? {
    language: "Chinese", title: /报告$/.test(topic) ? topic : named("研究报告"),
    gap: "此范围暂无可用的已核验证据，结论尚未验证；请补充相关原始证据后重试。",
    questionPrefix: "待核实问题：", omitted: "…[问题摘录，余文省略]",
    citationRemoved: "[引用标记已移除]", incompleteCitationRemoved: "[引用标记已移除：", linkRemoved: "[链接已移除]",
    summary: "所有章节尚未通过核验，本草稿不构成事实结论。",
    introduction: "已保留确认的研究范围，但尚无章节通过证据与质量核验；章节草稿和警告供后续补证使用。",
    conclusion: "请补充相关原始证据并重试待核实章节，再做决策或发布正式报告。当前无法形成跨章节的事实优先级。",
  } : {
    language: "English", title: /\breport$/i.test(topic) ? topic : named(" — Research report"),
    gap: "No usable verified excerpts are available for this scope. Findings remain unverified; obtain relevant primary evidence before drawing conclusions.",
    questionPrefix: "Unanswered question: ", omitted: "…[Question excerpt; remainder omitted]",
    citationRemoved: "[citation marker removed]", incompleteCitationRemoved: "[citation marker removed: ", linkRemoved: "[link removed]",
    summary: "All chapter findings remain unverified. This draft does not establish factual conclusions.",
    introduction: "The confirmed research scope has been retained, but no chapter passed the evidence and quality requirements. The chapter drafts and warnings record unresolved coverage for further research.",
    conclusion: "Obtain relevant primary evidence and retry the unresolved chapters before making decisions or publishing a formal report. No cross-chapter factual priorities can be established from this draft.",
  };
}
