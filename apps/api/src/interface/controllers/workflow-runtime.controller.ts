/**
 * WF03 —— Workflow Runtime HTTP 面：UC-WR-3 start、UC-WR-4 get、UC-WR-6 SSE、UC-WR-7 cancel、UC-WR-8 resume；
 * WF05 UC-WR-11 approveGate / UC-WR-12 denyGate。
 * 路径与载荷来自 `@repo/contracts/workflow-runtime`（单一事实源）；失败体为 WorkflowErrorBody。
 * 可见性判定在应用层（instance-projection.ts）：发起人 / 组织管理员可见，其余一律 404。
 */
import { Body, Controller, Get, Headers, HttpException, Inject, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { WORKFLOW_WEBHOOK_HEADERS, WorkflowErrorBody, WorkflowRequestId, workflowRuntime, type WorkflowErrorCode } from "@repo/contracts/workflow-runtime";
import { WorkflowCommandShapeError } from "../../application/workflow/instance-commands";
import { WorkflowUseCaseError } from "../../application/workflow/workflow-errors";
import { WORKFLOW_RUNTIME_SERVICE, type WorkflowRuntimeService } from "../../application/workflow/workflow-runtime-service";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { Public } from "../public.decorator";

const C = workflowRuntime;

const HTTP_STATUS: Record<WorkflowErrorCode, number> = {
  workflow_not_found: 404,
  workflow_version_not_published: 422,
  workflow_not_allowed: 403,
  skill_version_unresolved: 422,
  trigger_input_invalid: 422,
  definition_invalid: 422,
  state_version_conflict: 409,
  instance_terminal: 409,
  gate_already_decided: 409,
  gate_not_open: 409,
  not_designated_approver: 403,
  self_approval_forbidden: 403,
  deny_reason_required: 422,
  idempotency_key_reused: 409,
  webhook_signature_invalid: 401,
  lease_conflict: 409,
  stage_not_retryable: 409,
};

/**
 * 契约失败体（WorkflowErrorBody）直接写回：全局异常过滤器只放行 reasonCode，而 E3 要求 409 带 latestProjection。
 * 只映射本用例族的已知错误；其余异常照常抛给过滤器（internal_error，细节进日志）。
 */
function sendFailure(failure: unknown, res: Response): unknown {
  if (failure instanceof WorkflowUseCaseError) {
    const d = failure.details;
    res.status(HTTP_STATUS[failure.code]);
    return WorkflowErrorBody.parse({
      code: failure.code,
      message: failure.code,
      ...(d.latestProjection ? { latestProjection: d.latestProjection } : {}),
      ...(d.missingSkills ? { missingSkills: d.missingSkills } : {}),
      ...(d.decidedGate ? { decidedGate: d.decidedGate } : {}),
    });
  }
  if (failure instanceof WorkflowCommandShapeError) throw new HttpException({ reasonCode: "bad_request" }, 400);
  throw failure;
}

function parseLastEventId(header: string | undefined, query: string | undefined): number | undefined {
  const raw = header ?? query;
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

const POLL_MS = 150;

@Controller()
export class WorkflowRuntimeController {
  constructor(@Inject(WORKFLOW_RUNTIME_SERVICE) private readonly runtime: WorkflowRuntimeService) {}

  @Post(C.startInstance.path)
  async start(@CurrentPrincipal() principal: Principal, @Param("key") key: string, @Body() raw: unknown, @Res() res: Response) {
    assertPrincipal(principal);
    try {
      res.status(201).json(C.startInstance.out.parse(await this.runtime.start(principal.orgId, principal.userId, key, raw)));
    } catch (failure) { res.json(sendFailure(failure, res)); }
  }

  @Get(C.getInstance.path)
  async get(@CurrentPrincipal() principal: Principal, @Param("instanceId") instanceId: string, @Res() res: Response) {
    assertPrincipal(principal);
    try {
      res.status(200).json(C.getInstance.out.parse(await this.runtime.get(principal.orgId, principal.userId, instanceId)));
    } catch (failure) { res.json(sendFailure(failure, res)); }
  }

  @Post(C.cancelInstance.path)
  async cancel(@CurrentPrincipal() principal: Principal, @Param("instanceId") instanceId: string, @Body() raw: unknown, @Res() res: Response) {
    assertPrincipal(principal);
    try {
      res.status(200).json(C.cancelInstance.out.parse(await this.runtime.cancel(principal.orgId, principal.userId, instanceId, raw)));
    } catch (failure) { res.json(sendFailure(failure, res)); }
  }

  @Post(C.resumeInstance.path)
  async resume(@CurrentPrincipal() principal: Principal, @Param("instanceId") instanceId: string, @Body() raw: unknown, @Res() res: Response) {
    assertPrincipal(principal);
    try {
      res.status(200).json(C.resumeInstance.out.parse(await this.runtime.resume(principal.orgId, principal.userId, instanceId, raw)));
    } catch (failure) { res.json(sendFailure(failure, res)); }
  }

  /** WF05 UC-WR-11：批准人工门。 */
  @Post(C.approveGate.path)
  async approveGate(
    @CurrentPrincipal() principal: Principal,
    @Param("instanceId") instanceId: string,
    @Param("gateId") gateId: string,
    @Body() raw: unknown,
    @Res() res: Response,
  ) {
    assertPrincipal(principal);
    try {
      res.status(200).json(C.approveGate.out.parse(await this.runtime.approveGate(principal.orgId, principal.userId, instanceId, gateId, raw)));
    } catch (failure) { res.json(sendFailure(failure, res)); }
  }

  /** WF05 UC-WR-12：拒绝人工门（必填理由）。 */
  @Post(C.denyGate.path)
  async denyGate(
    @CurrentPrincipal() principal: Principal,
    @Param("instanceId") instanceId: string,
    @Param("gateId") gateId: string,
    @Body() raw: unknown,
    @Res() res: Response,
  ) {
    assertPrincipal(principal);
    try {
      res.status(200).json(C.denyGate.out.parse(await this.runtime.denyGate(principal.orgId, principal.userId, instanceId, gateId, raw)));
    } catch (failure) { res.json(sendFailure(failure, res)); }
  }

  /**
   * WF06 UC-WR-13：webhook 触发。无 principal（调用方是外部系统，靠 HMAC 而非会话认证，@Public()）；
   * 签名/时间戳/Idempotency-Key 来自头部（`WORKFLOW_WEBHOOK_HEADERS`）。请求体由 main.ts 的
   * raw 解析器交来 **原始字节**（Buffer）——签名覆盖原始字节（trigger-webhook.ts 文件头注），不做
   * JSON 重序列化，也不把非对象体静默改成 `{}`。
   *
   * 头部形状错误的映射（显式，而非一律吞成 401）：
   *   - 签名头缺失 / 时间戳头缺失或非正整数 → 401 webhook_signature_invalid（认证材料本身不成形）；
   *   - Idempotency-Key 缺失或不符合 WorkflowRequestId → 422 trigger_input_invalid（请求形状错误，不是认证失败）。
   */
  @Public()
  @Post(C.triggerWebhook.path)
  async webhook(
    @Param("triggerId") triggerId: string,
    @Headers(WORKFLOW_WEBHOOK_HEADERS.signature) signature: string | undefined,
    @Headers(WORKFLOW_WEBHOOK_HEADERS.timestamp) timestampHeader: string | undefined,
    @Headers(WORKFLOW_WEBHOOK_HEADERS.idempotencyKey) idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const fail = (status: number, code: "webhook_signature_invalid" | "trigger_input_invalid") =>
      res.status(status).json(WorkflowErrorBody.parse({ code, message: code }));
    const timestamp = /^[0-9]{1,12}$/.test(timestampHeader ?? "") ? Number(timestampHeader) : NaN;
    if (!signature || !Number.isSafeInteger(timestamp) || timestamp <= 0) return void fail(401, "webhook_signature_invalid");
    if (!WorkflowRequestId.safeParse(idempotencyKey ?? "").success) return void fail(422, "trigger_input_invalid");
    const rawBody = Buffer.isBuffer(body) ? body.toString("utf8") : "";
    try {
      const out = await this.runtime.webhook({ triggerId, signature, timestamp, idempotencyKey: idempotencyKey!, rawBody });
      res.status(200).json(C.triggerWebhook.out.parse(out));
    } catch (failure) { res.json(sendFailure(failure, res)); }
  }

  /** SSE：每条 `id: <seq>` + `data: <WorkflowSseEnvelope>`；Last-Event-ID 头（或 ?lastEventId=）续传。 */
  @Get(C.streamInstanceEvents.path)
  async stream(
    @CurrentPrincipal() principal: Principal,
    @Param("instanceId") instanceId: string,
    @Headers("last-event-id") lastEventHeader: string | undefined,
    @Query("lastEventId") lastEventQuery: string | undefined,
    @Res() response: Response,
  ) {
    assertPrincipal(principal);
    let cursor;
    try {
      cursor = await this.runtime.stream(principal.orgId, principal.userId, instanceId, parseLastEventId(lastEventHeader, lastEventQuery));
    } catch (failure) {
      response.json(sendFailure(failure, response));
      return;
    }
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();
    let connected = true;
    response.on("close", () => { connected = false; });
    let idle = 0;
    try {
      while (connected && !response.destroyed) {
        const { envelopes, done } = await cursor.next();
        for (const env of envelopes) {
          response.write(`id: ${env.seq}\nevent: ${env.type}\ndata: ${JSON.stringify(C.streamInstanceEvents.out.parse(env))}\n\n`);
        }
        if (done) break;
        idle = envelopes.length > 0 ? 0 : idle + POLL_MS;
        if (idle >= 15_000) { response.write(": keepalive\n\n"); idle = 0; }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } catch {
      // 头已发出：不能再改状态码。结束流，客户端带 Last-Event-ID 重连补发（E10）。
    } finally {
      if (!response.destroyed) response.end();
    }
  }
}
