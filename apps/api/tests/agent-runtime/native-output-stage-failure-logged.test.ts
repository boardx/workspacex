/**
 * `wx_artifact_publish` 被拒时，**真正的原因要留在服务端日志里**（2026-09-27 devapp 实测）。
 *
 * 那一轮：12 页 PPT 已渲染验收完，发布这一步被暂存端点拒了。`PgNativeOutputStaging.stage`
 * 有七八种拒绝原因（授权/租约被拒、同名文件已暂存、同幂等键内容冲突、超限……），控制器此前
 * `catch{throw 503}`——既不区分、也不记日志。事后没有任何地方能回答"到底是哪一种"。
 *
 * 这里钉住两件事：
 *   ① 原因进日志（带 runId / attemptId / leaseEpoch / toolCallId，够对上一次具体的调用）；
 *   ② 响应**不变**：仍是同一个 503 + `native_output_stage_failed`，内部原因不回给调用方。
 */
import { randomUUID } from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NativeOutputStagingController } from "../../src/interface/controllers/native-output-staging.controller";
import type { NativeOutputStaging } from "../../src/application/agent-run/native-output-staging";
import type { LoggerPort } from "../../src/application/ports/logger.port";

const KEY = "stage-log-test-key";
let oldKey: string | undefined;
beforeEach(() => { oldKey = process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY; process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY = KEY; });
afterEach(() => { if (oldKey === undefined) delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY; else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY = oldKey; });

function body() {
  return {
    orgId: "org-" + randomUUID(), attemptId: "run-1:1", leaseEpoch: 2, bindingId: randomUUID(), toolCallId: "publish-call",
    toolArgs: {
      workspacePath: "/workspace/design-thinking-history.pptx", title: "design-thinking-history.pptx",
      mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", idempotencyKey: "retry-key",
    },
  };
}

function capture(): { logger: LoggerPort; errors: { msg: string; fields: Record<string, unknown> }[] } {
  const errors: { msg: string; fields: Record<string, unknown> }[] = [];
  const logger = {
    info: () => {}, warn: () => {}, debug: () => {},
    error: (msg: string, fields: Record<string, unknown>) => { errors.push({ msg, fields }); },
  } as unknown as LoggerPort;
  return { logger, errors };
}

describe("暂存被拒：原因进日志，响应不变", () => {
  it("同名文件已暂存这类拒绝，原因落进日志，且能对上具体那一次调用", async () => {
    const staging: NativeOutputStaging = {
      stage: async () => { throw new Error("native_output_duplicate_name"); },
      listFiles: async () => [],
    } as unknown as NativeOutputStaging;
    const { logger, errors } = capture();
    const controller = new NativeOutputStagingController(staging, logger);

    await expect(controller.stage(KEY, "run-1", body())).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(errors).toHaveLength(1);
    const logged = JSON.stringify(errors[0]!.fields);
    expect(logged).toContain("native_output_duplicate_name");
    expect(errors[0]!.fields.runId).toBe("run-1");
    expect(errors[0]!.fields.toolCallId).toBe("publish-call");
    expect(errors[0]!.fields.leaseEpoch).toBe(2);
  });

  it("响应不变：仍是 native_output_stage_failed，内部原因不回给调用方", async () => {
    const staging = { stage: async () => { throw new Error("native_output_authority_denied"); } } as unknown as NativeOutputStaging;
    const controller = new NativeOutputStagingController(staging, capture().logger);

    const error = await controller.stage(KEY, "run-1", body()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const response = JSON.stringify((error as ServiceUnavailableException).getResponse());
    expect(response).toContain("native_output_stage_failed");
    expect(response).not.toContain("authority_denied");
  });

  it("没有注入日志端口时（既有的最小测试装配）照旧工作，不因为可选依赖缺席而崩", async () => {
    const staging = { stage: async () => { throw new Error("native_output_limit"); } } as unknown as NativeOutputStaging;
    const controller = new NativeOutputStagingController(staging);
    await expect(controller.stage(KEY, "run-1", body())).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
