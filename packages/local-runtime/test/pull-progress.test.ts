import { describe, expect, it, vi } from "vitest";
import {
  describePull, parsePullLine, PULL_LOG_INTERVAL_MS, pullModelWithProgress, shouldLogPull,
} from "../src/pull-progress";

describe("解析 Ollama 的拉取流", () => {
  it("带 total/completed 的行解出字节数", () => {
    expect(parsePullLine('{"status":"pulling 1a2b","total":3221225472,"completed":1610612736}'))
      .toEqual({ status: "pulling 1a2b", completedBytes: 1610612736, totalBytes: 3221225472 });
  });
  it("只有 status 的行也认（manifest 阶段没有总量）", () => {
    expect(parsePullLine('{"status":"pulling manifest"}'))
      .toEqual({ status: "pulling manifest", completedBytes: null, totalBytes: null });
  });
  it("空行与非 JSON 行忽略，不抛", () => {
    expect(parsePullLine("")).toBeNull();
    expect(parsePullLine("not json")).toBeNull();
  });
  it("error 行要抛出来，不能被当成一条普通进度吞掉", () => {
    expect(() => parsePullLine('{"error":"model not found"}')).toThrow("model not found");
  });
});

describe("进度文案", () => {
  it("有总量才说百分比", () => {
    const t = describePull("qwen3.5:4b", { status: "pulling", completedBytes: 1.5 * 1024 ** 3, totalBytes: 3 * 1024 ** 3 });
    expect(t).toContain("50%");
    expect(t).toContain("1.5/3.0 GB");
  });
  it("没总量时不编一个百分比，说当前状态", () => {
    const t = describePull("qwen3.5:4b", { status: "pulling manifest", completedBytes: null, totalBytes: null });
    expect(t).not.toContain("%");
    expect(t).toContain("pulling manifest");
  });
});

describe("日志节流", () => {
  it("第一条必写；内容没变不写；变了且到点才写", () => {
    expect(shouldLogPull(null, "a", 0)).toBe(true);
    expect(shouldLogPull({ text: "a", at: 0 }, "a", 10 ** 6)).toBe(false);
    expect(shouldLogPull({ text: "a", at: 0 }, "b", PULL_LOG_INTERVAL_MS - 1)).toBe(false);
    expect(shouldLogPull({ text: "a", at: 0 }, "b", PULL_LOG_INTERVAL_MS)).toBe(true);
  });
});

function streamOf(lines: readonly string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(new TextEncoder().encode(l + "\n"));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

describe("流式拉取", () => {
  it("一路读到 success 才算成功，并写出进度", async () => {
    const log = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(streamOf([
      '{"status":"pulling manifest"}',
      '{"status":"pulling a","total":3221225472,"completed":1610612736}',
      '{"status":"success"}',
    ])) as unknown as typeof fetch;
    const r = await pullModelWithProgress("http://127.0.0.1:11435", "qwen3.5:4b", log, fetchImpl);
    expect(r).toEqual({ ok: true });
    expect(log.mock.calls.flat().join("\n")).toContain("50%");
    expect(log.mock.calls.flat().join("\n")).toContain("完成");
  });

  it("流断在中途 ⇒ 不算成功（没收到 success 就是没拉完）", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(streamOf([
      '{"status":"pulling a","total":100,"completed":10}',
    ])) as unknown as typeof fetch;
    const r = await pullModelWithProgress("http://x", "m", vi.fn(), fetchImpl);
    expect(r.ok).toBe(false);
  });

  it("上游报错 ⇒ 带着原因返回，不静默成功", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(streamOf([
      '{"error":"pull model manifest: file does not exist"}',
    ])) as unknown as typeof fetch;
    const r = await pullModelWithProgress("http://x", "m", vi.fn(), fetchImpl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain("file does not exist");
  });

  it("连不上 ⇒ 带着原因返回", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    const r = await pullModelWithProgress("http://x", "m", vi.fn(), fetchImpl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain("ECONNREFUSED");
  });
});
