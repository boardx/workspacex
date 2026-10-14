import type { AgentDirectoryCard, AgentRoleCategory } from "./agent-directory";

/** Examples prefill an unsent task; they do not assert that a tool or workflow is executable. */
export interface AgentTaskExample {
  readonly label: string;
  readonly prompt: string;
}

const EXAMPLES: Readonly<Record<AgentRoleCategory, readonly AgentTaskExample[]>> = {
  research: [
    { label: "整理研究资料", prompt: "请帮我整理提供的研究资料，区分事实、推断和缺失信息，并注明来源。" },
    { label: "比较证据", prompt: "请帮我比较提供的证据，说明一致之处、分歧与尚不能下的结论。" },
  ],
  product: [
    { label: "起草产品需求", prompt: "请根据我提供的材料起草产品需求，明确问题、证据、范围和验收标准；缺失信息请标为待确认。" },
    { label: "梳理优先级", prompt: "请帮我梳理需求优先级，说明依据、约束和取舍，不替我批准路线图或预算。" },
  ],
  design: [
    { label: "准备用户访谈", prompt: "请帮我准备用户访谈，列出研究问题、访谈提纲和需要确认的条件，不编造已完成的访谈。" },
    { label: "设计工作坊", prompt: "请帮我设计一场设计思维工作坊，明确目标、参与者、活动和预期产物；未知条件请标为待确认。" },
  ],
  executive: [
    { label: "准备决策简报", prompt: "请帮我准备决策简报，区分事实、假设和判断，给出选项、风险及待确认事项。" },
  ],
  customer_success: [
    { label: "整理客户反馈", prompt: "请帮我整理提供的客户反馈，保留来源，区分问题、建议与待核实信息；先形成草稿。" },
  ],
  sales: [
    { label: "准备客户会议", prompt: "请根据我提供的材料准备客户会议，整理需求、关注点和待确认问题；不要声称已经查询或更新 CRM。" },
  ],
  operations: [
    { label: "梳理项目行动", prompt: "请根据我提供的项目材料梳理行动项，标明负责人、依赖和待确认事项，不编造期限或执行结果。" },
  ],
  general: [
    { label: "整理我的材料", prompt: "请帮我整理提供的材料，列出要点与待确认问题；未读取的内容不要猜测。" },
  ],
};

export function agentTaskExamples(card: Pick<AgentDirectoryCard, "roleCategory">): readonly AgentTaskExample[] {
  return EXAMPLES[card.roleCategory ?? "general"];
}

export function directoryWorkflowStatus(
  card: Pick<AgentDirectoryCard, "readiness" | "workflows">,
): { readonly label: string; readonly tone: "neutral" | "attention"; readonly description: string } {
  if (card.readiness !== "ready") {
    return {
      label: "部分能力待开通",
      tone: "attention",
      description: "日常对话可以开始；需要额外配置的执行能力，请在详情中核对。",
    };
  }
  return card.workflows.length === 0
    ? { label: "对话模式", tone: "neutral", description: "目录未列出关联工作流。" }
    : {
      label: "流程待确认",
      tone: "neutral",
      description: "目录提供的是关联流程信息，不包含业务验收结果。请在详情中核对具体流程是否可发起。",
    };
}
