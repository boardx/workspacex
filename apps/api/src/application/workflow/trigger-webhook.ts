/**
 * WF06 —— UC-WR-13 `triggerWebhook`（usecases.md）：POST /workflow-triggers/:triggerId/webhook。
 *
 * HMAC-SHA256（`x-workspacex-signature`）+ 5 分钟时间戳窗（`x-workspacex-timestamp`，
 * `WORKFLOW_WEBHOOK_TIMESTAMP_WINDOW_SECONDS`）；`Idempotency-Key` 作 requestId 落
 * `startInstanceFromTrigger` 的幂等外壳（同 key 不同 payload → 409 idempotency_key_reused，I-6）。
 * 运行身份 = 触发器 owner；签名/窗口/触发器不存在时**不写 receipt、不建实例**（先于任何幂等外壳）。
 * 调用方只拿 `{instanceId,status}`（R5）——密钥、签名、payload 明文都不进返回体或错误体（I-15）。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { WORKFLOW_WEBHOOK_TIMESTAMP_WINDOW_SECONDS, type WorkflowInstanceStatus } from "@repo/contracts/workflow-runtime";
import { startInstanceFromTrigger, type InstanceCommandDeps } from "./instance-commands";
import { resolveActor } from "./instance-projection";
import { WorkflowUseCaseError } from "./workflow-errors";
import type { WorkflowTriggerStore } from "./workflow-trigger-ports";

export interface TriggerWebhookDeps extends InstanceCommandDeps {
  triggers: WorkflowTriggerStore;
  /** 当前时间（秒），测试注入；生产默认 `Date.now()/1000`。 */
  now?(): number;
}

export interface TriggerWebhookCommand {
  triggerId: string;
  signature: string;
  timestamp: number;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface TriggerWebhookResponse {
  instanceId: string;
  status: WorkflowInstanceStatus;
}

/** 与 instance-commands.ts 的 fingerprint 用同一套 stable JSON 规则,签名覆盖的字节与调用方能重放的字节一致。 */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

function signedDigest(secret: string, timestamp: number, idempotencyKey: string, payload: Record<string, unknown>): string {
  return createHmac("sha256", secret).update(`${timestamp}.${idempotencyKey}.${stableJson(payload)}`).digest("hex");
}

/** 常数时间比较；长度不等或任一侧不是合法 hex 时视为不匹配（从不因异常而误判为匹配）。 */
function hexEquals(expected: string, provided: string): boolean {
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(provided, "hex");
    return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function triggerWebhook(deps: TriggerWebhookDeps, cmd: TriggerWebhookCommand): Promise<TriggerWebhookResponse> {
  const trigger = await deps.triggers.find(cmd.triggerId);
  if (!trigger || trigger.kind !== "webhook") {
    throw new WorkflowUseCaseError("workflow_not_found", "workflow trigger not found");
  }

  const nowSeconds = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  const withinWindow = Math.abs(nowSeconds - cmd.timestamp) <= WORKFLOW_WEBHOOK_TIMESTAMP_WINDOW_SECONDS;
  const expected = trigger.secretRef ? signedDigest(trigger.secretRef, cmd.timestamp, cmd.idempotencyKey, cmd.payload) : null;
  if (!withinWindow || !expected || !hexEquals(expected, cmd.signature)) {
    // 签名/时间戳错误：先于任何 receipt.begin，不建实例（usecases.md UC-WR-13）。密钥/签名不进错误体（I-15）。
    throw new WorkflowUseCaseError("webhook_signature_invalid", "webhook signature invalid");
  }

  const actor = await resolveActor(deps.access, trigger.orgId, trigger.ownerUserId);
  const response = await startInstanceFromTrigger(deps, {
    orgId: trigger.orgId,
    actorUserId: actor.userId,
    key: trigger.workflowKey,
    version: trigger.version ?? undefined,
    agentId: trigger.agentId,
    input: cmd.payload,
    triggerKind: "webhook",
    requestKey: cmd.idempotencyKey,
  });
  return { instanceId: response.instanceId, status: response.status };
}
