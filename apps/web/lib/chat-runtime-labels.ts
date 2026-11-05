// Owned display literals only. Existing helpers reexport the compatibility names.
export const TRANSPORT_ERROR_TEXT = {
  AGENT_RUN_TIMEOUT: "这次执行超时了，还没有等到结果",
  THREAD_NOT_VISIBLE: "这个对话你当前没有查看权限",
  NO_WRITE_ROLE: "你在这个对话里没有发言权限",
  THREAD_ARCHIVED_READONLY: "这个对话已归档，仅可查看，不能继续发言",
  AGENT_NOT_FOUND: "找不到可用的 Agent，请联系管理员",
  IDEMPOTENCY_CONFLICT: "这次请求与另一次正在进行的请求冲突，请重试",
  TITLE_INVALID: "对话标题不合法",
  RESULT_UNREADABLE: "回复已生成，但暂时读取不到内容",
  AUTHZ_UNAVAILABLE: "权限校验服务暂时不可用，请稍后重试",
  NO_PENDING_APPROVAL: "没有待处理的审批请求",
  AGENT_RUN_NOT_AWAITING_TOOL_PERMISSION: "这次执行当前不处于等待审批状态",
  INTERNAL_ERROR: "系统内部出了点问题",
  COPILOTKIT_RUNTIME_RUN_FAILED: "这次请求没有成功，请重试",
  // chat-parity-attachments (issue #2022)
  ATTACHMENT_NOT_PENDING: "有附件已经失效或不属于这个对话，请移除后重新上传",
} as const;
export const RUN_RECOVERED_NOTICE =
  "这一轮已经完成，中途有步骤出错但已经恢复，上面的结果可以正常使用。";

export const RUN_RESTORE_PHASE_LABEL = "正在恢复上次未完成的任务…";

export const REPLYING_PHASE_LABEL = "正在回复…";

export const RUN_ERROR_UNKNOWN = "执行失败，原因未知";
export const RUN_ERROR_GENERIC = "这次执行没有成功，请重试或联系管理员";
