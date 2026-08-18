/**
 * #1560 · P1 —— 抽取核心把图片接到视觉端口上的接线与**降级**反证（内存假件，不打外部 API）。
 *
 * 要证四件事：
 *   ① 图片走 vision → 产物经**与 pptx 完全同一条**路径落库（putOnce 全文 + recordExtracted 有界摘录）。
 *   ② 没接视觉能力 / key 缺失 → 落 failed + 如实原因，`extracted_ref` 保持空——不留幽灵成功。
 *   ③ 可重试故障（transport）→ 返回 "retry" 且**一个终态都不记**（不许把网络抖动写成永久失败）。
 *   ④ 非图片路径一字节不变：csv 仍走 converter，视觉端口**一次都没被调用**。
 */
import { describe, expect, it } from "vitest";
import { extractAttachment, extractedObjectKey, type ExtractionCoreDeps } from "../../src/application/chat/attachment-extraction-worker";
import type { AttachmentExtractionStore, ExtractionErrorCode } from "../../src/application/chat/attachment-extraction-store";
import type { AttachmentVisionPort, VisionResult } from "../../src/application/chat/attachment-vision.port";
import type { AttachmentToMarkdownPort } from "../../src/application/chat/attachment-to-markdown.port";
import { composeVisionMarkdown } from "../../src/domain/chat/attachment-vision";
import { ObjectExistsError, type ObjectStore } from "../../src/application/artifact/ports";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-vision");
const ATT = "att-img";

function memStore(): ObjectStore & { map: Map<string, Uint8Array> } {
  const map = new Map<string, Uint8Array>();
  return {
    map,
    async putOnce(key, bytes) { if (map.has(key)) throw new ObjectExistsError(key); map.set(key, bytes); },
    async get(key) { return map.get(key) ?? null; },
    async head(key) { const v = map.get(key); return v ? { sizeBytes: v.byteLength, mime: "application/octet-stream" } : null; },
  };
}

interface Recorded {
  extracted: { ref: string; excerpt: string } | null;
  failed: ExtractionErrorCode | null;
  unsupported: boolean;
}

function memExtraction(mime: string): AttachmentExtractionStore & { rec: Recorded } {
  const rec: Recorded = { extracted: null, failed: null, unsupported: false };
  return {
    rec,
    async enqueue() {}, async claimNext() { return null; }, async complete() {}, async markJobFailed() {},
    async readAttachment() { return { storageRef: `chat-attachments/${ORG}/${ATT}`, mime }; },
    async recordExtracted(_o, _a, ref, excerpt) { rec.extracted = { ref, excerpt }; },
    async recordUnsupported() { rec.unsupported = true; },
    async recordFailed(_o, _a, code) { rec.failed = code; },
  };
}

const neverConverter: AttachmentToMarkdownPort = {
  async convert() { throw new Error("converter 不该被图片路径调用"); },
};

function visionPort(result: VisionResult): AttachmentVisionPort & { calls: number } {
  const port = {
    calls: 0,
    async describeImage(): Promise<VisionResult> { port.calls += 1; return result; },
  };
  return port;
}

async function seededStore(): Promise<ReturnType<typeof memStore>> {
  const store = memStore();
  await store.putOnce(`chat-attachments/${ORG}/${ATT}`, new Uint8Array([0x89, 0x50]), "image/png");
  return store;
}

describe("图片抽取接线（#1560 P1）", () => {
  it("① 视觉抽取成功 → 与文档同一条落库路径：全文进对象存储 + 摘录进 DB", async () => {
    const store = await seededStore();
    const extraction = memExtraction("image/png");
    const markdown = composeVisionMarkdown({
      modelId: "qwen-vl-test", reply: { transcript: "季度复盘", description: "一张幻灯片截图" },
    });
    const vision = visionPort({ ok: true, markdown, modelId: "qwen-vl-test" });

    const outcome = await extractAttachment({ store, extraction, converter: neverConverter, vision }, ORG, ATT);

    expect(outcome).toBe("extracted");
    expect(vision.calls).toBe(1);
    const ref = extractedObjectKey(ORG, ATT);
    expect(extraction.rec.extracted?.ref).toBe(ref);
    expect(new TextDecoder().decode(store.map.get(ref)!)).toBe(markdown);
    // 摘录里能读到图中文字与模型名——这正是它进上下文/L3 检索后能被搜到的东西。
    expect(extraction.rec.extracted?.excerpt).toContain("季度复盘");
    expect(extraction.rec.extracted?.excerpt).toContain("qwen-vl-test");
    expect(extraction.rec.failed).toBeNull();
    expect(extraction.rec.unsupported).toBe(false);
  });

  it("② 未接视觉能力 → failed + visionNotConfigured，不落任何产物", async () => {
    const store = await seededStore();
    const extraction = memExtraction("image/png");

    const outcome = await extractAttachment({ store, extraction, converter: neverConverter }, ORG, ATT);

    expect(outcome).toBe("failed");
    expect(extraction.rec.failed).toBe("visionNotConfigured");
    expect(extraction.rec.extracted).toBeNull();
    expect(store.map.has(extractedObjectKey(ORG, ATT))).toBe(false);
  });

  it("② key/模型不可用 → failed 且原因如实落库（不是笼统失败，也不是 unsupported）", async () => {
    for (const code of ["visionNotConfigured", "visionModelUnavailable", "visionRejected", "visionImageTooLarge"] as const) {
      const store = await seededStore();
      const extraction = memExtraction("image/png");
      const vision = visionPort({ ok: false, code });

      const outcome = await extractAttachment({ store, extraction, converter: neverConverter, vision }, ORG, ATT);

      expect(outcome).toBe("failed");
      expect(extraction.rec.failed).toBe(code);
      expect(extraction.rec.extracted).toBeNull();
      expect(extraction.rec.unsupported).toBe(false);
    }
  });

  it("③ 传输故障 → retry，且**一个终态都没记**（网络抖动不写成永久失败）", async () => {
    const store = await seededStore();
    const extraction = memExtraction("image/png");
    const vision = visionPort({ ok: false, code: "visionTransport" });

    const outcome = await extractAttachment({ store, extraction, converter: neverConverter, vision }, ORG, ATT);

    expect(outcome).toBe("retry");
    expect(extraction.rec).toEqual({ extracted: null, failed: null, unsupported: false });
  });

  it("④ 回归：csv 仍走 converter，视觉端口一次都没被调用", async () => {
    const store = memStore();
    await store.putOnce(`chat-attachments/${ORG}/${ATT}`, new TextEncoder().encode("a,b\n1,2\n"), "text/csv");
    const extraction = memExtraction("text/csv");
    const vision = visionPort({ ok: true, markdown: "不该出现", modelId: "x" });
    const converter: AttachmentToMarkdownPort = { async convert() { return { ok: true, markdown: "| a | b |" }; } };

    const outcome = await extractAttachment({ store, extraction, converter, vision }, ORG, ATT);

    expect(outcome).toBe("extracted");
    expect(vision.calls).toBe(0);
    expect(extraction.rec.extracted?.excerpt).toBe("| a | b |");
  });
});
