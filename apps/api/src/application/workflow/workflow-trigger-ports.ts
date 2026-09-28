/**
 * WF06 —— WorkflowTrigger 读端口（domain.md「WorkflowTrigger」：`workflow_triggers`）。
 * webhook 触发（trigger-webhook.ts）与 pg-boss 定时唤醒（deliver-scheduled-trigger.ts）共用。
 *
 * `secretRef` 只在 `trigger-webhook.ts` 内部用于 HMAC 校验，从不写入事件、provenance 或任何响应体（I-15）。
 */
export interface WorkflowTriggerRecord {
  triggerId: string;
  orgId: string;
  kind: "schedule" | "webhook";
  workflowKey: string;
  /** 缺省 = 该 key 在白名单内最新 published（同 UC-WR-3 Q5 的约定）。 */
  version: number | null;
  /** 运行身份：webhook/定时唤醒都以触发器 owner 的身份准入与冻结实例（domain.md）。 */
  ownerUserId: string;
  agentId: string;
  /** 仅 webhook 触发器非空；schedule 触发器没有签名校验，恒为 null。 */
  secretRef: string | null;
  /** 仅 schedule 触发器使用：pg-boss 作业没有调用方 payload,运行输入在建触发器时冻结于此;webhook 忽略本字段,输入来自请求体。 */
  defaultInput: Record<string, unknown>;
}

export interface WorkflowTriggerStore {
  find(triggerId: string): Promise<WorkflowTriggerRecord | null>;
}
