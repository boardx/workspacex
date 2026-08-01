/**
 * `recordCustomerDataCall` -- F54 (UC-21.2 R3 步骤 6 / R12 V6 / V6a / V7): 涉客户数据
 * 服务器的每次调用全量留痕，写入 `provenance_events`；**留痕失败则调用失败**（R7 硬前置，
 * 承接 UC-4.4 R7「没有留痕就没有调用」）。
 *
 * ## 为什么这个函数在"调用发生之后"才叫，却仍能让调用失败
 *
 * 这不是一个事后统计任务——它是调用路径本身的一段。调用方（工具调用编排层，phase-1 尚未
 * 落地，见 `application/mcp/ports.ts` F52 文件头同类说明）必须在拿到工具的返回结果之后、
 * **在把结果交回给 agent 之前**调用它；`writer.append` 抛出的错误必须原样向上传播，
 * 变成"这次调用失败"，而不是被吞掉后台重试——重试会打破"全量"这个承诺（重试窗口内的
 * 那次真实调用没有对应的留痕）。
 *
 * ⚠ **借用的事件类型，不是新语义**：`TOOL_CALL_AUDIT_TYPE`（借 `"generated"`）与
 *   `domain/chat/tool-call-projection.ts`（F111）是**同一个借用事实**——MCP 工具调用与
 *   chat 束的工具调用共享"一次调用产出一段结果"这个语义缺口，复用同一个常量而不是
 *   各自借出第二份，理由同 AGENTS.md「同一事实不得声明在两处」。`target.kind` 不借用，
 *   `"capability"` 是 MCP 服务器的准确归类（不像 chat 束需要借 `thread`）。
 */
import { buildCustomerDataTraceDetail, type CustomerDataCallInput } from "../../domain/mcp/customer-data-trace";
import { TOOL_CALL_AUDIT_TYPE } from "../../domain/chat/tool-call-projection";
import type { ProvenanceWriter } from "../provenance/ports";
import type { OrgId } from "../../domain/org-id";

export interface RecordCustomerDataCallDeps {
  readonly provenance: ProvenanceWriter;
}

export interface RecordCustomerDataCallInput extends CustomerDataCallInput {
  readonly orgId: OrgId;
  /** 读 O-01 参数（`SecurityPolicy.provenanceRetentionDays`），**不是本函数的常量** */
  readonly retentionDays: number;
}

export interface RecordCustomerDataCallResult {
  readonly provenanceEventId: string;
  readonly retentionUntil: string;
}

export async function recordCustomerDataCall(
  deps: RecordCustomerDataCallDeps,
  input: RecordCustomerDataCallInput,
): Promise<RecordCustomerDataCallResult> {
  const detail = buildCustomerDataTraceDetail(input, input.retentionDays);

  // 留痕失败 = 调用失败：不 catch，任由 append 的错误向上传播。
  const provenanceEventId = await deps.provenance.append({
    orgId: input.orgId,
    type: TOOL_CALL_AUDIT_TYPE,
    actorId: input.callerId,
    target: { kind: "capability", id: input.serverId },
    detail: { ...detail },
  });

  return { provenanceEventId, retentionUntil: detail.retentionUntil };
}
