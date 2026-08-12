/**
 * `uploadAttachment` 的网络层单测 —— 它用 XMLHttpRequest（不是 fetch）才能给出**真实上传进度**。
 * 这里 stub 一个假 XHR，验证三件事：
 *   · upload.onprogress → onProgress(比例)，成功后补一个 1；
 *   · 2xx → resolve 解析后的附件；
 *   · 非 2xx → ApiError 带 reasonCode（供 composer 就地报错映射），网络失败 → ApiError(status 0)。
 * node 环境（无 DOM），完全由假 XHR 驱动。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadAttachment } from "@/lib/live-chat";
import { ApiError } from "@/lib/api-client";

class FakeXHR {
  static last: FakeXHR | null = null;
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 0;
  responseText = "";
  withCredentials = false;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  sentBody: unknown = null;
  constructor() { FakeXHR.last = this; }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  send(body: unknown) { this.sentBody = body; }
  // 测试驱动：
  emitProgress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
  finish(status: number, text: string) { this.status = status; this.responseText = text; this.onload?.(); }
  fail() { this.onerror?.(); }
}

function stubXHR() {
  vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest);
}

function file(name = "x.pdf") {
  return new File([new Uint8Array(8)], name, { type: "application/pdf" });
}

describe("uploadAttachment（XHR 真实进度）", () => {
  afterEach(() => { vi.unstubAllGlobals(); FakeXHR.last = null; });

  it("upload.onprogress → onProgress(比例)，成功后补 1，并 resolve 解析后的附件", async () => {
    stubXHR();
    const seen: number[] = [];
    const p = uploadAttachment("t", file(), "tok", (f) => seen.push(f));
    const xhr = FakeXHR.last!;
    expect(xhr.method).toBe("POST");
    expect(xhr.headers.Authorization).toBe("Bearer tok");
    xhr.emitProgress(25, 100);
    xhr.emitProgress(80, 100);
    const attachment = { id: "att-1", filename: "x.pdf", mime: "application/pdf", bytes: 8, createdAt: "2026-01-01T00:00:00.000Z" };
    xhr.finish(200, JSON.stringify(attachment));
    await expect(p).resolves.toEqual(attachment);
    expect(seen).toEqual([0.25, 0.8, 1]); // 末尾补 1
  });

  it("非 2xx → ApiError 带 reasonCode（不吞掉服务端拒因）", async () => {
    stubXHR();
    const p = uploadAttachment("t", file(), "tok");
    const xhr = FakeXHR.last!;
    xhr.finish(413, JSON.stringify({ reasonCode: "FILE_TOO_LARGE" }));
    await expect(p).rejects.toMatchObject({ status: 413, reasonCode: "FILE_TOO_LARGE" });
    await expect(p).rejects.toBeInstanceOf(ApiError);
  });

  it("网络层失败 → ApiError(status 0)（composer 映射为可重试）", async () => {
    stubXHR();
    const p = uploadAttachment("t", file(), "tok");
    FakeXHR.last!.fail();
    await expect(p).rejects.toMatchObject({ status: 0 });
    await expect(p).rejects.toBeInstanceOf(ApiError);
  });
});
