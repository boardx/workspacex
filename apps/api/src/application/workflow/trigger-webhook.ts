/**
 * WF06 —— UC-WR-13 `triggerWebhook`（usecases.md）：POST /workflow-triggers/:triggerId/webhook。
 *
 * ## 签名串（调用方照此计算）
 *
 *   signature = hex( HMAC-SHA256( secret, `${timestamp}.${idempotencyKey}.${rawBody}` ) )
 *
 * `rawBody` 是**请求体原始字节**（UTF-8 解码），服务端不重新序列化、不排序 key——调用方对自己真正发出的
 * 字节签名即可（空白、key 顺序都原样参与）。`timestamp` = `x-workspacex-timestamp` 头（unix 秒，
 * 5 分钟窗 `WORKFLOW_WEBHOOK_TIMESTAMP_WINDOW_SECONDS`），`idempotencyKey` = `Idempotency-Key` 头。
 * 这条签名串尚未写进契约束（已作为签核待决问题记录在 WF06 issue / sprint progress,见 Q7 草案）。
 *
 * 所有「未认证」失败——触发器不存在 / 非 webhook kind / 无密钥 / 窗口外 / 签名不符——统一
 * 401 webhook_signature_invalid,不让未认证调用方借 404/401 之差探测哪些 triggerId 存在。
 * 认证通过后：请求体不是 JSON 对象 → 422 trigger_input_invalid；触发器 owner 已不在组织 →
 * 403 workflow_not_allowed（Agent 不可运行同样是 workflow_not_allowed，来自 UC-WR-3 内核）。
 * 签名失败时**不写 receipt、不建实例**（先于任何幂等外壳，E7）。R9 轮换：当前与上一把密钥任一匹配即通过。
 * 调用方只拿 `{instanceId,status}`（R5）——密钥、签名、payload 明文都不进返回体或错误体（I-15）。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { WORKFLOW_WEBHOOK_TIMESTAMP_WINDOW_SECONDS, type WorkflowInstanceStatus } from "@repo/contracts/workflow-runtime";
import { startInstanceFromTrigger, type InstanceCommandDeps } from "./instance-commands";
import { WorkflowUseCaseError } from "./workflow-errors";
import type { WorkflowTriggerStore } from "./workflow-trigger-ports";

export interface TriggerWebhookDeps extends InstanceCommandDeps {
  triggers: WorkflowTriggerStore;
  /** 当前时间（毫秒，同 `Date.now()`），测试注入。 */
  now?(): number;
}

export interface TriggerWebhookCommand {
  triggerId: string;
  signature: string;
  timestamp: number;
  idempotencyKey: string;
  /** 请求体原始字节（UTF-8）；签名覆盖的正是它，解析成 payload 在验签之后。 */
  rawBody: string;
}

export interface TriggerWebhookResponse {
  instanceId: string;
  status: WorkflowInstanceStatus;
}

function signedDigest(secret: string, timestamp: number, idempotencyKey: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${idempotencyKey}.${rawBody}`, "utf8").digest("hex");
}

function parseObjectBody(rawBody: string): Record<string, unknown> | null {
  if (rawBody.trim().length === 0) return {};
  try {
    const v: unknown = JSON.parse(rawBody);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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
  const unauthenticated = () => new WorkflowUseCaseError("webhook_signature_invalid", "webhook signature invalid");
  const trigger = await deps.triggers.find(cmd.triggerId);
  // 不存在 / 非 webhook 与签名错同码（见文件头注）：未认证调用方不能借此探测 triggerId。
  if (!trigger || trigger.kind !== "webhook") throw unauthenticated();

  const nowSeconds = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  const withinWindow = Math.abs(nowSeconds - cmd.timestamp) <= WORKFLOW_WEBHOOK_TIMESTAMP_WINDOW_SECONDS;
  const matched = trigger.webhookSecrets.some((secret) =>
    hexEquals(signedDigest(secret, cmd.timestamp, cmd.idempotencyKey, cmd.rawBody), cmd.signature),
  );
  if (!withinWindow || !matched) {
    // 签名/时间戳错误：先于任何 receipt.begin，不建实例（usecases.md UC-WR-13）。密钥/签名不进错误体（I-15）。
    throw unauthenticated();
  }

  const payload = parseObjectBody(cmd.rawBody);
  if (!payload) throw new WorkflowUseCaseError("trigger_input_invalid", "webhook body must be a JSON object");

  const role = await deps.access.orgRoleOf(trigger.orgId, trigger.ownerUserId);
  if (!role) throw new WorkflowUseCaseError("workflow_not_allowed", "trigger owner can no longer run this workflow");
  const response = await startInstanceFromTrigger(deps, {
    orgId: trigger.orgId,
    actorUserId: trigger.ownerUserId,
    key: trigger.workflowKey,
    version: trigger.version ?? undefined,
    agentId: trigger.agentId,
    input: payload,
    triggerKind: "webhook",
    // I-6 修复：requestKey 必须按 triggerId 域隔离——调用方自带的 Idempotency-Key 只在单个触发器内保证
    // 唯一,两个不同 webhook 触发器（不同 triggerId）恰好收到相同 Idempotency-Key 时,若不带 triggerId
    // 会在 receipt key 上撞车,第二个调用被误判为「同一请求重放」而拿到 409（而不是各自建各自的实例）。
    requestKey: `${cmd.triggerId}:${cmd.idempotencyKey}`,
  });
  return { instanceId: response.instanceId, status: response.status };
}
