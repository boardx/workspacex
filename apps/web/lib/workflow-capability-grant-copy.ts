/**
 * 工作流权限授予 —— 用户可见文案单源（管理页 + 运行面板阻断横幅共用）。
 *
 * 能力分类 id（`artifact.write`…）是内置 Workflow 目录里的技术标识，这里给每一个配一句人话：
 * 它允许工作流「做什么」、不授予时「会怎样」。目录里新增分类而这里没写时走兜底文案，不白屏。
 * 错误码穷举契约闭集（`lint-user-facing-error-text`：不把内部码原样上屏）。
 */
import type { workflowCapabilityGrants } from "@repo/contracts";
import type { z } from "zod";
import { ApiError } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";

type Cap = z.infer<typeof workflowCapabilityGrants.WorkflowCapabilityGrant>["sideEffectCap"];
type ErrorCode = z.infer<typeof workflowCapabilityGrants.WorkflowCapabilityGrantError>;

/** 管理页路由（运行面板横幅链接到这里）。 */
export const WORKFLOW_GRANTS_HREF = "/org-admin/workflow-grants";

export interface CapabilityCopy {
  readonly label: string;
  /** 授予后工作流可以做什么。 */
  readonly allows: string;
}

const CAPABILITY_COPY: Record<string, CapabilityCopy> = {
  "artifact.write": { label: "保存产出文档", allows: "把工作流生成的文档（如 PRD、调研报告、计划）保存到本组织的文件库，或更新已有版本。" },
  "notify.inapp": { label: "发送站内通知", allows: "在工作流完成或需要协作时，给相关成员发送站内通知。" },
  "board.write": { label: "更新任务看板", allows: "在项目看板上创建或更新任务卡片（如把会议行动项落成任务）。" },
  "interview.write": { label: "创建访谈", allows: "按工作流规划的提纲，在访谈模块里创建访谈。" },
  "interview.outline.write": { label: "导入访谈提纲", allows: "把工作流生成的访谈提纲导入到访谈模块。" },
  "workflow.record.write": { label: "写入实验记录", allows: "登记实验预注册与上线确认等过程记录。" },
  "mail.send": { label: "发送邮件", allows: "把工作流生成的内容通过邮件发送给指定收件人。" },
  "knowledge.read": { label: "查阅知识库", allows: "读取本组织知识库中的资料作为工作流的参考。" },
  "project.read": { label: "在审批中引用项目信息", allows: "在计划审批环节读取并引用项目资料，审批结论会被写回运行记录。" },
  "workflow.gate": { label: "人工确认", allows: "工作流在这一步等待指定成员确认后才继续。" },
  "ticket.write": { label: "更新工单", allows: "回写工单的分诊结果、状态，或在同一工单线程里回复（对外回复仍需人工批准）。" },
  "tracker.write": { label: "在缺陷追踪器里升级问题", allows: "经人工批准后，把问题升级到外部缺陷追踪器并建立关联。" },
  "kb.publish": { label: "发布帮助文章", allows: "把经人工确认的解决方案发布到知识库或帮助中心。" },
  "docs.publish": { label: "发布到受控文档库", allows: "把经批准的流程或制度文档发布到受控文档库。" },
  "project.write": { label: "创建或更新项目", allows: "在立项获批后创建项目，或把已有项目挂接到这次立项。" },
  "project.member.write": { label: "添加项目成员", allows: "在立项获批后把指定成员加入新项目。" },
  "knowledge.graph.write": { label: "写入组织知识", allows: "把经人确认的决定登记到组织知识图谱，供日后检索引用。" },
  "team.roster.read": { label: "在审批中引用团队名单", allows: "在估算审批环节读取团队成员名单，审批结论会被写回运行记录。" },
};

export function capabilityCopy(category: string): CapabilityCopy {
  return CAPABILITY_COPY[category] ?? { label: "其它操作权限", allows: "工作流在该步骤需要改动本组织内的数据。" };
}

export const CAP_LEVEL: Record<Cap, { label: string; description: string }> = {
  none: { label: "已禁止", description: "工作流不能使用这项能力。" },
  read: { label: "只读（默认）", description: "只能查看，不能新建、修改或发送任何内容。" },
  write: { label: "可写入", description: "可以在本组织内新建或修改内容，内容不会离开组织。" },
  external_send: { label: "可对外发送", description: "在可写入之外，还可以把内容发送或分享到组织外部。" },
};

const ERROR_TEXT: Record<ErrorCode, string> = {
  NOT_ORG_ADMIN: "只有组织管理员可以查看和调整工作流权限",
  UNKNOWN_CAPABILITY: "这项能力不在内置工作流目录里，刷新页面后再试",
  DEPENDENCY_UNAVAILABLE: "权限服务暂时不可用，稍后再试一次",
};

export function describeWorkflowGrantFailure(err: unknown): string {
  if (err instanceof ApiError) {
    const code = err.reasonCode;
    if (code !== null && code in ERROR_TEXT) return ERROR_TEXT[code as ErrorCode];
    return httpFailureText(err.status);
  }
  if (err instanceof TypeError) return "连不上服务器，检查一下网络再试";
  return "操作没有完成，稍后再试一次";
}

const TARGET_SYSTEM_TEXT: Record<string, string> = {
  smtp: "邮件服务",
  inapp: "站内通知",
  files: "组织文件库",
  board: "任务看板",
  workflow: "本次工作流运行",
  artifact: "组织文件库",
  notify: "站内通知",
  mail: "邮件服务",
};

/** 副作用目标系统的人话名；不认识时给兜底，原始值只进「技术详情」。 */
export function targetSystemText(target: string): string {
  return TARGET_SYSTEM_TEXT[target] ?? "组织内的其它系统";
}
