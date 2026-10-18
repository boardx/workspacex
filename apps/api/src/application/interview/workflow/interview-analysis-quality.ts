import { interviewMarkdown } from "@repo/contracts";
import type { ModelCallPort } from "../../agent-run/ports";
import { DigitalInterviewWorkflowError } from "./digital-interview-runtime.port";

const guidance: Record<interviewMarkdown.InterviewAnalysisSectionKind, string> = {
  goal: "把用户输入转为可通过访谈回答的问题，说明需要支持的决策，不把目标当成已证实结论，不预设一定存在负面或正面影响。",
  participants: "建议互补的受访角色或专家类型，并说明每类能提供什么信息；不虚构真人身份或访谈样本。",
  scope: "界定具体场景、比较维度与排除范围；资料未给出的时间、地区、人数等写为待确认；如提出筛选阈值或时间窗，必须标为建议参数、待确认，不得伪装成用户既定要求。",
  criteria: "说明拿到哪些行为案例、反例或可交叉核对的材料才足以支持下一步决策，不预设正向结果，不要求证明某类人群必然由某一因素驱动；成功是获得可比较的材料而非证实预设结论。",
  recommendations: `用编号列表给出至少${interviewMarkdown.MIN_INTERVIEW_ANALYSIS_ACTIONS}条针对本次需求的具体访谈行动；每条写清怎么做、为什么、要获取或核验什么证据。不要仅说进一步研究、加强沟通。先开放式回溯实际行为；假设情境回答只能作为自述意向，不能代替真实行为证据。`,
  hypotheses: "列出需要验证的问题或可反驳假设，并说明如何寻找反例；不把可能性或相关性写成因果结论。",
  boundaries: "区分输入已提供的信息与尚缺材料，指出本次研究不能推断什么，以及需要哪类真实资料验证；模拟画像不是真人证据。日记、回忆、访谈口述和环境描述均属自报材料，不能称客观证据或未经修饰的真实行为；单个案例或反例不能证明群体比例、因果关系或因素权重。",
};
export const INTERVIEW_ANALYSIS_INSTRUCTIONS = [
  "基于用户已确认的输入生成访谈研究设计，不要只回答主题科普或复制需求。建议须具体对应输入场景，能指导下一步选专家和设计问题。",
  "如果输入很短，仍给出与该主题相关的探索路径，同时明确未知信息；不编造背景、统计、引用或确定性结论。",
  "严格使用以下二级章节，每章都有实质正文；可以有三级子标题。不要只写待补充、暂无或通用口号：",
  ...interviewMarkdown.INTERVIEW_ANALYSIS_SECTIONS.map(item => `## ${item.title}\n${guidance[item.kind]}`),
].join("\n\n");

function missingSections(markdown: string) {
  const candidate = interviewMarkdown.InterviewMarkdownDocument.safeParse({ documentId: "analysis-candidate", step: "analysis", version: 1,
    contentHash: "0".repeat(64), evidenceMode: "simulated", references: [], markdown });
  return candidate.success ? interviewMarkdown.projectInterviewAnalysis(candidate.data).missing : interviewMarkdown.INTERVIEW_ANALYSIS_SECTIONS.map(item => item.kind);
}

/** At most one correction. It never persists, invents a fallback, or overwrites an existing document. */
export async function repairInterviewAnalysis(model: Pick<ModelCallPort, "complete">,
  request: Parameters<ModelCallPort["complete"]>[0], markdown: string): Promise<string> {
  const missing = missingSections(markdown);
  if (!missing.length) return markdown;
  const titles = interviewMarkdown.INTERVIEW_ANALYSIS_SECTIONS.filter(item => missing.includes(item.kind)).map(item => item.title);
  const response = await model.complete({ ...request,
    system: `${request.system}\n\n本次结构纠偏必须完整重写分析，不再续写片段；不要解释纠偏过程。${INTERVIEW_ANALYSIS_INSTRUCTIONS}`,
    user: `${request.user}\n\n上一版缺少有实质内容的章节：${titles.join("、")}。请保留本次研究主题，依据上方已确认输入完整重写全部章节。不要用固定模板句充数。`,
  });
  if (response.cancelled || response.paused || response.interrupted || response.truncated || !response.text.trim() || missingSections(response.text).length) {
    throw new DigitalInterviewWorkflowError("AI_GENERATION_UNAVAILABLE");
  }
  return response.text;
}
