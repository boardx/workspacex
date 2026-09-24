/**
 * 结构化失败字段**不许退化成消息本身**（2026-09-25 真实模型十任务矩阵实测）。
 *
 * ## 量到的后果
 *
 * 十个真实 Office 任务跑下来，服务端日志里有 **19 次「skill trial run script attempt
 * failed」，一条 stderr 原文都没有**——落库的 detail 是
 * `{ raw: "skill trial run script attempt failed" }`，也就是把 `msg` 列那句话
 * 又抄了一遍。排查的人看得到「失败了」，看不到「为什么」。
 *
 * ## 根因
 *
 * 适配器写的是 `err: detail.detail ?? message`，而应用层传的是
 * `{ attempt, exitCode, stderrExcerpt }`——它没有 `.detail` 这个键，于是整包被丢弃。
 * 同一段代码在 9 处各写了一遍（本仓头号病），所以每一处都错。
 *
 * 现在只有 `structuredErrorLog` 一份，下面逐条钉住它的优先级。
 */
import { describe, expect, it, vi } from "vitest";
import { structuredErrorLog } from "../../src/application/ports/logger.port";

function capture() {
  const calls: { msg: string; fields: Record<string, unknown> }[] = [];
  const logger = { error: vi.fn((msg: string, fields: Record<string, unknown>) => { calls.push({ msg, fields }); }) };
  return { logger, calls };
}

describe("structuredErrorLog", () => {
  it("没有 err/detail 键时，整包结构化字段进 err——不是把消息抄一遍", () => {
    const { logger, calls } = capture();
    structuredErrorLog(logger, () => "trace-1")(
      "skill trial run script attempt failed",
      { attempt: 2, exitCode: 1, stderrExcerpt: "TypeError: pres.ShapeType is not a function" },
    );
    const err = calls[0]?.fields.err as Record<string, unknown>;
    expect(err.stderrExcerpt).toBe("TypeError: pres.ShapeType is not a function");
    expect(err.exitCode).toBe(1);
    // 这一条是本文件的支点：退化成消息字符串就等于什么都没记。
    expect(typeof err).not.toBe("string");
  });

  it("调用方显式给了 err 时以它为准", () => {
    const { logger, calls } = capture();
    const boom = new Error("boom");
    structuredErrorLog(logger, () => "t")("失败了", { err: boom, runId: "r1" });
    expect(calls[0]?.fields.err).toBe(boom);
  });

  it("调用方用 detail 这个键时同样尊重（既有调用方的写法）", () => {
    const { logger, calls } = capture();
    structuredErrorLog(logger, () => "t")("失败了", { detail: "上游原话" });
    expect(calls[0]?.fields.err).toBe("上游原话");
  });

  it("detail 为空对象时才退回消息——此时确实没有别的可记", () => {
    const { logger, calls } = capture();
    structuredErrorLog(logger, () => "t")("没有额外信息的失败", {});
    expect(calls[0]?.fields.err).toBe("没有额外信息的失败");
  });

  it("traceId 每次现取，不共用同一个", () => {
    const { logger, calls } = capture();
    let n = 0;
    const log = structuredErrorLog(logger, () => `t${String(++n)}`);
    log("a", { x: 1 });
    log("b", { x: 2 });
    expect(calls.map((c) => c.fields.traceId)).toEqual(["t1", "t2"]);
  });
});
