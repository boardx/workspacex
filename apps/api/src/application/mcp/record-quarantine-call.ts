/**
 * `recordQuarantineCallTrace` -- F131 (UC-21.1 R3 步骤 3 补 / I-30′): 隔离期内的每一次调用
 * 尝试（无论最终放行还是被拒）都写入 `provenance_events`，**不受开关二「涉客户数据才留痕」
 * 影响**。
 *
 * ## 与 `recordCustomerDataCall`（F54）是两条平行但独立的留痕路径
 *
 * 后者按 `server.involvesCustomerData` 门控——不涉客户数据、开关二又关闭时，它不写。
 * 本函数的留痕义务来自「处于隔离期」这件事本身，与是否涉客户数据、开关二开或关**正交**：
 * 一台隔离期内的服务器即使不涉客户数据，其间的每次调用（含被拒）也必须留痕。两条路径
 * 因此各自独立调用，互不替代——把二者合并成一个"要不要写"的布尔判断，会在
 * "不涉客户数据 ∧ 开关二关闭 ∧ 仍在隔离期"这一格悄悄丢掉留痕。
 *
 * ⚠ **借用 `TOOL_CALL_AUDIT_TYPE`**，理由与 `record-customer-data-call.ts` 同：MCP 工具调用
 *   与 chat 束的工具调用共享"一次调用产出一段结果"这个语义缺口，不各自另开一份事件类型。
 */
import { TOOL_CALL_AUDIT_TYPE } from "../../domain/chat/tool-call-projection";
import type { ProvenanceWriter } from "../provenance/ports";
import type { OrgId } from "../../domain/org-id";

export interface RecordQuarantineCallDeps {
  readonly provenance: ProvenanceWriter;
}

export interface QuarantineCallTraceInput {
  readonly orgId: OrgId;
  readonly serverId: string;
  readonly toolFullName: string;
  readonly actorId: string;
  /** 这次尝试最终是放行还是被拒——**两种都要留痕**，反向断言不可省。 */
  readonly allowed: boolean;
  readonly isPlatformGroup: boolean;
  readonly quarantineUntil: string;
  readonly at: Date;
}

/** 留痕失败 = 这次调用失败：不 catch，任由 `provenance.append` 的错误向上传播（同 F54 R7）。 */
export async function recordQuarantineCallTrace(
  deps: RecordQuarantineCallDeps,
  input: QuarantineCallTraceInput,
): Promise<string> {
  return deps.provenance.append({
    orgId: input.orgId,
    type: TOOL_CALL_AUDIT_TYPE,
    actorId: input.actorId,
    target: { kind: "capability", id: input.serverId },
    detail: {
      toolFullName: input.toolFullName,
      allowed: input.allowed,
      isPlatformGroup: input.isPlatformGroup,
      quarantineUntil: input.quarantineUntil,
      at: input.at.toISOString(),
    },
  });
}
