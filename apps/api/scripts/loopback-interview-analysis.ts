import { interviewMarkdown } from '@repo/contracts';

/** Explicit HTTP test double only; not a production fallback or quality evidence. */
export function loopbackInterviewAnalysis(system: string, user: string): string | null {
  if (!system.includes('你是专业用户研究员。') || !/^操作：generate_analysis$/mu.test(user)) return null;
  const bodies: Record<interviewMarkdown.InterviewAnalysisSectionKind,string> = {
    goal: '受控测试提案：核对需求中的实际行为及其约束，研究问题须由人工审阅。',
    participants: '建议招募需求涉及的执行者及协作角色，具体身份与人数待人工确认。',
    scope: '依据输入需求比较实际场景，地区、时间窗、排除范围均待确认。',
    criteria: '收集可比较的具体案例与反例，不以证实预设结论作为成功标准。',
    recommendations: '1. 请受访者回溯最近一次相关经历的具体时间线，区分回忆与可核对记录。\n2. 对比不同角色在相同场景中的约束，寻找可以交叉核对的行为材料。\n3. 主动追问与初步假设不一致的案例，记录差异和仍需验证的信息。',
    hypotheses: '待验证：角色之间可能存在不同约束，需要寻找相反案例并比较解释。',
    boundaries: '这是显式回环模型的确定性测试提案，不是真实模型质量证据；回忆与口述为自报材料，模拟画像不能替代真人证据。',
  };
  return interviewMarkdown.INTERVIEW_ANALYSIS_SECTIONS.map(section=>`## ${section.title}\n\n${bodies[section.kind]}`).join('\n\n');
}
