// live-recording-capture.test.ts — #466 步骤 7 第一段的反证。
//
// 这里要证的不是「能录音」（那要真浏览器，归 e2e），而是**失败的时候说了什么**：
// 权限被拒 / 无麦克风 / 采音管线起不来，三种必须各自具名且可渲染，
// 并且**绝不返回一个「看起来在录」的句柄** —— 假装在录是这类功能最坏的失败方式。
import { describe, expect, it, vi } from "vitest";
import {
  LiveRecordingError,
  TARGET_SAMPLE_RATE,
  classifyMediaError,
  startCapture,
  toPcm16,
} from "@/lib/live-recording";

function domError(name: string): Error {
  const error = new Error(`mock ${name}`);
  error.name = name;
  return error;
}

describe("#466 采音失败必须具名且可渲染", () => {
  it.each([
    ["NotAllowedError", "permission-denied"],
    ["SecurityError", "permission-denied"],
    ["PermissionDeniedError", "permission-denied"],
    ["NotFoundError", "no-microphone"],
    ["DevicesNotFoundError", "no-microphone"],
    ["OverconstrainedError", "no-microphone"],
  ])("%s → %s", (name, kind) => {
    const detail = classifyMediaError(domError(name));
    expect(detail.kind).toBe(kind);
    // 给人看的话必须真的存在，且不是把英文错误名原样丢出来
    expect(detail.message.length).toBeGreaterThan(10);
    expect(detail.message).not.toContain(name);
  });

  it("不认识的异常归到 capture-failed，但保留原始名供日志——不静默、也不编造语义", () => {
    const detail = classifyMediaError(domError("SomeBrandNewError"));
    expect(detail.kind).toBe("capture-failed");
    expect(detail.cause).toBe("SomeBrandNewError");
    expect(detail.message.length).toBeGreaterThan(10);
  });

  it("按错误名判定，不按 message 文本——message 是本地化的，拿它做判据等于把判定绑在语言设置上", () => {
    const localized = new Error("用户拒绝了权限请求");
    localized.name = "NotAllowedError";
    expect(classifyMediaError(localized).kind).toBe("permission-denied");

    const misleading = new Error("permission denied");
    misleading.name = "NotFoundError";
    expect(classifyMediaError(misleading).kind, "文本里有 permission 也不能改判").toBe("no-microphone");
  });

  it("权限被拒时抛 LiveRecordingError，绝不返回一个看起来在录的句柄", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(domError("NotAllowedError"));
    await expect(startCapture({ getUserMedia })).rejects.toBeInstanceOf(LiveRecordingError);
    await expect(startCapture({ getUserMedia })).rejects.toMatchObject({ kind: "permission-denied" });
  });

  it("拿到流但没有音轨 —— 也要失败，并且把轨道关掉不留悬挂设备占用", async () => {
    const stop = vi.fn();
    const stream = { getAudioTracks: () => [], getTracks: () => [{ stop }] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    await expect(startCapture({ getUserMedia })).rejects.toMatchObject({ kind: "no-microphone" });
    expect(stop, "失败路径必须释放设备").toHaveBeenCalled();
  });

  it("AudioContext 起不来时释放麦克风，不把设备占用泄在那里", async () => {
    const stop = vi.fn();
    const track = { stop };
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const createAudioContext = vi.fn(() => { throw domError("NotSupportedError"); });
    await expect(startCapture({ getUserMedia, createAudioContext })).rejects.toMatchObject({
      kind: "capture-failed",
    });
    expect(stop).toHaveBeenCalled();
  });
});

describe("#466 PCM16 转码（上游要求 16000Hz / 单声道 / 16 位小端）", () => {
  it("48kHz 降到 16kHz：长度按比例缩到三分之一", () => {
    const input = new Float32Array(4800).fill(0);
    const out = toPcm16(input, 48_000);
    expect(out).toBeInstanceOf(Int16Array);
    expect(out.length).toBe(1600);
    expect(TARGET_SAMPLE_RATE).toBe(16_000);
  });

  it("已经是 16kHz 时不重采样", () => {
    const out = toPcm16(new Float32Array(1600), 16_000);
    expect(out.length).toBe(1600);
  });

  it("量化到 16 位有符号范围，且不溢出绕回", () => {
    // 反证：超出 [-1,1] 的采样如果不先夹，乘完会绕回成**反相的巨响**
    const out = toPcm16(Float32Array.from([1, -1, 2, -2, 0]), 16_000);
    expect(out[0]).toBe(32_767);
    expect(out[1]).toBe(-32_768);
    expect(out[2], "超出上界必须夹住，不能绕回负数").toBe(32_767);
    expect(out[3], "超出下界必须夹住，不能绕回正数").toBe(-32_768);
    expect(out[4]).toBe(0);
    for (const value of out) {
      expect(value).toBeGreaterThanOrEqual(-32_768);
      expect(value).toBeLessThanOrEqual(32_767);
    }
  });

  it("采样率无效时失败，不是默默按某个默认值转码", () => {
    expect(() => toPcm16(new Float32Array(10), 0)).toThrow(LiveRecordingError);
    expect(() => toPcm16(new Float32Array(10), Number.NaN)).toThrow(LiveRecordingError);
  });
});

describe("#466 本模块不认识任何上游 ASR 端点", () => {
  it("采音层不得出现上游地址或凭据 —— 直连上游必然泄 key（design-delta 硬边界一）", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../../lib/live-recording.ts", import.meta.url), "utf8");
    const code = source
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
      })
      .join("\n");
    expect(code).not.toContain("aliyuncs.com");
    expect(code).not.toMatch(/wss?:\/\//);
    expect(code).not.toMatch(/API_KEY|apiKey|Authorization/);
  });
});
