// asr-stream-session.test.ts — #466 第二段的反证。
//
// ⚠ 反证要打在**对的接缝**上。今天已有实证：`drop-write` 红得太早、够不到 reload，
// 无法排除「只写进了内存」；必须再来一道 `noop-write`（不落库但返回成功）才把
// 「真的经过落库」单独隔离出来。本文件对每条硬边界都按这个要求设计：
//
//   授权/机密域 → 不只断言「被拒」，还断言**上游根本没被打开**
//                （拒了但仍连上游 = 音频已经出去了，拒得毫无意义）
//   落库唯一路径 → 不只断言「调了 ingestSegment」，还断言**它抛错时不得伪造 asr.final**
//                （返回一个假的 segmentId = 界面显示已保存，实际什么都没有）
import { describe, expect, it, vi } from "vitest";
import {
  openAsrStream,
  type AsrStreamDeps,
  type UpstreamAsr,
  type UpstreamTranscript,
} from "../../src/application/recording/asr-stream-session";

const SESSION = "rec_session_1";

function upstreamReturning(results: UpstreamTranscript[]): { upstream: UpstreamAsr; open: ReturnType<typeof vi.fn> } {
  const upstream: UpstreamAsr = {
    push: vi.fn().mockResolvedValue(results),
    commit: vi.fn().mockResolvedValue(results),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { upstream, open: vi.fn().mockResolvedValue(upstream) };
}

function deps(overrides: Partial<AsrStreamDeps> = {}): AsrStreamDeps & { openUpstream: ReturnType<typeof vi.fn> } {
  const { open } = upstreamReturning([]);
  return {
    authorize: vi.fn().mockResolvedValue("ok"),
    dataScope: vi.fn().mockResolvedValue("normal"),
    openUpstream: open,
    ingestSegment: vi.fn().mockResolvedValue({ segmentId: "seg_1", lowConfidence: false, text: "你好" }),
    ...overrides,
  } as AsrStreamDeps & { openUpstream: ReturnType<typeof vi.fn> };
}

describe("#466 三道门在任何音频被接收之前走完", () => {
  it("无项目角色 → 拒绝，且**上游根本没被打开**", async () => {
    const d = deps({ authorize: vi.fn().mockResolvedValue("no-project-role") });
    const { session, rejection } = await openAsrStream(SESSION, d);
    expect(session).toBeNull();
    expect(rejection).toEqual({ type: "asr.error", reason: "NO_PROJECT_ROLE" });
    // 接缝：拒了但仍连上游，等于音频已经出去了 —— 拒得毫无意义
    expect(d.openUpstream).not.toHaveBeenCalled();
  });

  it("会话已结束 → SESSION_ENDED，且上游没被打开", async () => {
    const d = deps({ authorize: vi.fn().mockResolvedValue("session-ended") });
    const { session, rejection } = await openAsrStream(SESSION, d);
    expect(session).toBeNull();
    expect(rejection).toMatchObject({ reason: "SESSION_ENDED" });
    expect(d.openUpstream).not.toHaveBeenCalled();
  });

  it("机密数据域 → fail-closed，且上游没被打开（音频绝不出境）", async () => {
    const d = deps({ dataScope: vi.fn().mockResolvedValue("confidential") });
    const { session, rejection } = await openAsrStream(SESSION, d);
    expect(session).toBeNull();
    expect(rejection).toMatchObject({ reason: "CONFIDENTIAL_SCOPE_FORBIDS_EXTERNAL_ASR" });
    expect(d.openUpstream, "机密域下连一次上游就已经泄了").not.toHaveBeenCalled();
  });

  it("未配置提供方 → ASR_NOT_CONFIGURED 的诚实降级，不偷偷回退到别的提供方", async () => {
    const { session, rejection } = await openAsrStream(SESSION, deps({ openUpstream: null }));
    expect(session).toBeNull();
    expect(rejection).toMatchObject({ reason: "ASR_NOT_CONFIGURED" });
  });

  it("门的顺序是授权 → 机密域 → 提供方：授权不过时连数据域都不查", async () => {
    const dataScope = vi.fn().mockResolvedValue("normal");
    await openAsrStream(SESSION, deps({ authorize: vi.fn().mockResolvedValue("no-project-role"), dataScope }));
    expect(dataScope).not.toHaveBeenCalled();
  });
});

describe("#466 落库只有一条路", () => {
  it("final 结果经既有 ingestSegment 落库；partial **不落库**", async () => {
    const { upstream, open } = upstreamReturning([
      { text: "你", final: false, confidence: 0.4 },
      { text: "你好", final: true, confidence: 0.93 },
    ]);
    const ingestSegment = vi.fn().mockResolvedValue({ segmentId: "seg_7", lowConfidence: false, text: "你好" });
    const { session } = await openAsrStream(SESSION, deps({ openUpstream: open, ingestSegment }));
    await session!.handle({ type: "asr.start", trackId: "trk_1", idempotencyKeyPrefix: "cli-abc" });
    const frames = await session!.handle({ type: "audio", pcm: new Int16Array(4) });

    expect(ingestSegment, "两段结果里只有 final 那段该落库").toHaveBeenCalledTimes(1);
    expect(ingestSegment).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: SESSION, trackId: "trk_1", rawText: "你好", idempotencyKey: "cli-abc-1",
    }));
    expect(frames).toEqual([
      { type: "asr.partial", text: "你" },
      { type: "asr.final", segmentId: "seg_7", text: "你好", lowConfidence: false },
    ]);
    expect(upstream.push).toHaveBeenCalledOnce();
  });

  it("🔴 对的接缝：ingestSegment 抛错时**绝不伪造 asr.final**", async () => {
    // 只断言「调了 ingestSegment」是不够的 —— 调了但忽略结果、照样回一个
    // segmentId，界面会显示「已保存」而实际什么都没有。这条把「真的落库了」
    // 从「看起来落库了」里单独隔离出来。
    const { open } = upstreamReturning([{ text: "你好", final: true, confidence: 0.9 }]);
    const ingestSegment = vi.fn().mockRejectedValue(new Error("db down"));
    const logUpstreamFailure = vi.fn();
    const { session } = await openAsrStream(SESSION, deps({ openUpstream: open, ingestSegment, logUpstreamFailure }));
    await session!.handle({ type: "asr.start", trackId: "trk_1", idempotencyKeyPrefix: "cli-abc" });
    const frames = await session!.handle({ type: "audio", pcm: new Int16Array(4) });

    expect(frames.some((f) => f.type === "asr.final"), "落库失败却回了 asr.final = 界面撒谎").toBe(false);
    expect(frames).toEqual([{ type: "asr.error", reason: "ASR_PROVIDER_UNAVAILABLE" }]);
  });

  it("幂等键随段递增，重连重放同一段命中同一个键", async () => {
    const { open } = upstreamReturning([{ text: "一", final: true, confidence: 0.9 }]);
    const ingestSegment = vi.fn().mockResolvedValue({ segmentId: "s", lowConfidence: false, text: "一" });
    const start = { type: "asr.start", trackId: "trk_1", idempotencyKeyPrefix: "cli-abc" } as const;

    const first = await openAsrStream(SESSION, deps({ openUpstream: open, ingestSegment }));
    await first.session!.handle(start);
    await first.session!.handle({ type: "audio", pcm: new Int16Array(2) });
    await first.session!.handle({ type: "audio", pcm: new Int16Array(2) });
    expect(ingestSegment.mock.calls.map((c) => c[0].idempotencyKey)).toEqual(["cli-abc-1", "cli-abc-2"]);

    // 断线重连：同一个 prefix 重放，键必须落回同一串（去重靠 ingestSegment 既有约束）
    ingestSegment.mockClear();
    const again = await openAsrStream(SESSION, deps({ openUpstream: open, ingestSegment }));
    await again.session!.handle(start);
    await again.session!.handle({ type: "audio", pcm: new Int16Array(2) });
    expect(ingestSegment.mock.calls[0]![0].idempotencyKey).toBe("cli-abc-1");
  });

  it("第一帧不是 asr.start 时拒绝：没有 trackId 与幂等前缀，落库没有归属与去重依据", async () => {
    const ingestSegment = vi.fn();
    const { session } = await openAsrStream(SESSION, deps({ ingestSegment }));
    const frames = await session!.handle({ type: "audio", pcm: new Int16Array(2) });
    expect(frames).toEqual([{ type: "asr.error", reason: "AUDIO_FORMAT_REJECTED" }]);
    expect(ingestSegment).not.toHaveBeenCalled();
  });
});

describe("#466 错误语义不编造", () => {
  it("不认识的上游故障 → ASR_PROVIDER_UNAVAILABLE，原始信息只进日志不进客户端帧", async () => {
    const upstream: UpstreamAsr = {
      push: vi.fn().mockRejectedValue(new Error("upstream said: quota_exceeded_for_project_42")),
      commit: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const logUpstreamFailure = vi.fn();
    const { session } = await openAsrStream(SESSION, deps({
      openUpstream: vi.fn().mockResolvedValue(upstream),
      logUpstreamFailure,
    }));
    await session!.handle({ type: "asr.start", trackId: "t", idempotencyKeyPrefix: "p" });
    const frames = await session!.handle({ type: "audio", pcm: new Int16Array(2) });

    expect(frames).toEqual([{ type: "asr.error", reason: "ASR_PROVIDER_UNAVAILABLE" }]);
    expect(JSON.stringify(frames), "上游原文不得下发客户端").not.toContain("quota_exceeded");
    expect(logUpstreamFailure, "但必须留在服务端日志里，否则没法排查").toHaveBeenCalled();
  });

  it("上游连不上 → 不建会话，且报 ASR_PROVIDER_UNAVAILABLE 而不是「未配置」", async () => {
    const { session, rejection } = await openAsrStream(SESSION, deps({
      openUpstream: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    }));
    expect(session).toBeNull();
    // 「连不上」与「没配置」是两件事：混成一个会让人去查配置而不是查网络
    expect(rejection).toMatchObject({ reason: "ASR_PROVIDER_UNAVAILABLE" });
  });

  it("finish 之后再来帧一律 SESSION_ENDED，不静默吞掉", async () => {
    const { session } = await openAsrStream(SESSION, deps());
    await session!.handle({ type: "asr.start", trackId: "t", idempotencyKeyPrefix: "p" });
    expect(await session!.handle({ type: "asr.finish" })).toEqual([{ type: "asr.finished" }]);
    expect(await session!.handle({ type: "audio", pcm: new Int16Array(2) }))
      .toEqual([{ type: "asr.error", reason: "SESSION_ENDED" }]);
  });
});

describe("#466 本模块不认识上游是谁", () => {
  it("编排层源码里不得出现上游地址或凭据（design-delta 硬边界一）", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../../src/application/recording/asr-stream-session.ts", import.meta.url),
      "utf8",
    );
    const code = source
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
      })
      .join("\n");
    // ⚠ 第一版这条红了，但**红错了原因**：触发它的是本文件自己那个叫
    // `Authorization` 的授权结果类型，不是任何凭据泄漏。断言要禁的是
    // **凭据材料**，不是这个英文单词——它在授权语境里会正当地反复出现。
    // 所以改为只盯真正的凭据形态：上游域名、ws 端点、bearer/密钥字面量，
    // 以及作为**带引号的 header 名**出现的 Authorization。
    expect(code).not.toMatch(/aliyuncs\.com|dashscope/i);
    expect(code).not.toMatch(/wss?:\/\//);
    expect(code).not.toMatch(/API_KEY|apiKey|bearer|qwen/i);
    expect(code, "Authorization 作为 header 字面量才是问题").not.toMatch(/["'`]Authorization["'`]/);
  });
});
