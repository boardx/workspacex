/**
 * WF07 —— 引导式研究的命令幂等 receipt 落通用 `workflow_receipts`（02-workflow-runtime.md R3-12；
 * domain.md「WorkflowReceipt 沿用 guided research begin/finalize 形状」）。取代旧表
 * guided_research_node_receipts 的读写；旧行由迁移 20260929070000 搬过来。
 *
 * request_key = `guided-research:<sessionId>:<requestId>`（scope = command）：同一组织内按会话隔离，
 * 迁移 SQL 按同一拼法写入旧行；tests/workflow/guided-research-migration.test.ts 断言迁过来的行能被本适配器读回。
 */
import { research as C } from "@repo/contracts";
import type { DatabasePort } from "../../application/ports/database.port";
import { guard } from "../../application/security/permission-filter";
import { GuidedResearchWorkflowError } from "../../application/research/guided-workflow-service";
import type {
  GuidedResearchNodeReceiptReplay,
  GuidedResearchNodeReceiptRepository,
  GuidedResearchWorkflowProjection,
} from "../../application/research/guided-workflow-receipt-ports";
import { GUIDED_RESEARCH_WORKFLOW_KEY } from "../../application/research/guided-research-workflow-graph";
import { WorkflowUseCaseError } from "../../application/workflow/workflow-errors";
import type { OrgId } from "../../domain/org-id";
import { PgWorkflowReceiptStore } from "../workflow/pg-workflow-receipt-store";

export function guidedResearchRequestKey(sessionId: string, requestId: string): string {
  return `${GUIDED_RESEARCH_WORKFLOW_KEY}:${sessionId}:${requestId}`;
}

function markReceiptRowScoped(sessionId: string): void {
  // receipt 是 controller 已经按会话鉴权后的内部幂等记录，不是独立披露面；显式挂到研究对象上，
  // 让结构化权限路径 lint 看得见（与旧实现同理由）。
  void guard({ kind: "research", id: sessionId }, { kind: "guided-research-node-receipt" });
}

export class PgGuidedResearchWorkflowReceipts implements GuidedResearchNodeReceiptRepository {
  private readonly store: PgWorkflowReceiptStore;

  constructor(private readonly db: DatabasePort) {
    this.store = new PgWorkflowReceiptStore(db);
  }

  async find(input: { orgId: OrgId; sessionId: string; requestId: string }): Promise<GuidedResearchNodeReceiptReplay | null> {
    markReceiptRowScoped(input.sessionId);
    return this.db.withTenant(input.orgId, async (s) => {
      const { rows } = await s.query<{ fingerprint: string; status: string; stable_response: unknown }>(
        `SELECT fingerprint, status, stable_response FROM workflow_receipts
          WHERE org_id = $1 AND scope = 'command' AND request_key = $2`,
        [input.orgId, guidedResearchRequestKey(input.sessionId, input.requestId)],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        payloadFingerprint: row.fingerprint,
        stableResponse: row.status === "finalized" && row.stable_response !== null
          ? C.GuidedResearchWorkflowProjection.parse(row.stable_response)
          : null,
      };
    });
  }

  async begin(input: {
    orgId: OrgId; sessionId: string; requestId: string; node: string; action: string; payloadFingerprint: string;
  }): Promise<GuidedResearchWorkflowProjection | null> {
    markReceiptRowScoped(input.sessionId);
    try {
      // store.begin 在指纹不同时抛 WorkflowUseCaseError；走到这里的非 begun 结果都是**同指纹**并发：
      // 已完成 → 回放；仍在执行 → BUSY（不是 mismatch）。
      const began = await this.store.begin(this.key(input, input.payloadFingerprint));
      if (began.kind === "begun") return null;
      if (began.kind === "replay" && began.stableResponse !== null && began.stableResponse !== undefined) {
        return C.GuidedResearchWorkflowProjection.parse(began.stableResponse);
      }
      throw new GuidedResearchWorkflowError("RESEARCH_WORKFLOW_BUSY");
    } catch (error) {
      if (error instanceof WorkflowUseCaseError) throw new GuidedResearchWorkflowError("RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH");
      throw error;
    }
  }

  async finalize(input: {
    orgId: OrgId; sessionId: string; requestId: string; checkpointId: string; graphVersion: number;
    stableResponse: GuidedResearchWorkflowProjection;
  }): Promise<void> {
    markReceiptRowScoped(input.sessionId);
    const current = await this.find(input);
    if (!current) throw new Error(`guided research receipt ${input.requestId} was not begun`);
    await this.store.finalize(this.key(input, current.payloadFingerprint), {
      stableResponse: input.stableResponse,
      checkpointId: input.checkpointId,
      instanceId: null,
    });
  }

  private key(input: { orgId: OrgId; sessionId: string; requestId: string }, fingerprint: string) {
    return {
      orgId: input.orgId,
      scope: "command" as const,
      requestKey: guidedResearchRequestKey(input.sessionId, input.requestId),
      fingerprint,
    };
  }
}
