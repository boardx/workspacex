/**
 * F37 -- 每个 Segment 能回到原件的具体位置，锚点随模态而不同（uc-22-2 R7）：
 *
 *   PDF/Office   -> anchor kind "page"          (页码)
 *   图片 OCR      -> anchor kind "image-region"  (识别区域)
 *   音视频 ASR    -> anchor kind "timecode"       (时间码)
 *   CSV 结构化    -> anchor kind "question-no"    (行号/题号)
 *   JSONL 结构化  -> anchor kind "message-id"     (消息 id)
 *
 * Against in-memory doubles (issue #74). Drives EXTRACTED then SEGMENTED through the real
 * worker (`ingestion-worker.ts`), so the anchor kind asserted here is what the pipeline
 * actually persists via `ArtifactRepository.addSegments`, not what the pure adapter function
 * merely returns in isolation.
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { uploadArtifact, type UploadArtifactDeps } from "../../src/application/files/upload-artifact";
import { runIngestionWorkerTick, type IngestionWorkerDeps } from "../../src/application/files/ingestion-worker";
import type { QuarantineRepository, SecurityAlertPort } from "../../src/application/files/upload-ports";
import { FakeArtifactRepository, FakeObjectStore, SequentialIdFactory } from "../support/artifact-fakes";
import { InMemoryIngestionOutbox } from "../support/ingestion-outbox-fakes";

const ORG = toOrgId("org-f37-anchors");
const PROJECT = "proj-f37-anchors";

class NoopQuarantine implements QuarantineRepository {
  async record(): Promise<void> {}
}
class NoopAlerts implements SecurityAlertPort {
  async raise(): Promise<void> {}
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
const enc = (s: string) => new TextEncoder().encode(s);

function pdfBytes(pages: readonly string[]): Uint8Array {
  return enc(`%PDF-1.4\n${pages.join("\f")}`);
}
function pngOcrBytes(regions: readonly string[]): Uint8Array {
  const magic = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return concat(magic, enc(`\n${regions.join("\n\n")}`));
}
function wavAsrBytes(lines: readonly string[]): Uint8Array {
  const header = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
  return concat(header, enc(`\n${lines.join("\n")}`));
}
function csvBytes(header: string, rows: readonly string[]): Uint8Array {
  return enc([header, ...rows].join("\n"));
}
function jsonlBytes(objs: readonly Record<string, unknown>[]): Uint8Array {
  return enc(objs.map((o) => JSON.stringify(o)).join("\n"));
}

function harness() {
  const repo = new FakeArtifactRepository();
  const store = new FakeObjectStore();
  const ids = new SequentialIdFactory();
  const uploadDeps: UploadArtifactDeps = {
    store,
    repo,
    ids,
    quarantine: new NoopQuarantine(),
    alerts: new NoopAlerts(),
  };
  const outbox = new InMemoryIngestionOutbox();
  const workerDeps: IngestionWorkerDeps = { outbox, artifacts: repo, ids, store };
  return { repo, store, ids, uploadDeps, outbox, workerDeps };
}

/** Drives a fresh upload all the way through EXTRACTED and SEGMENTED, returns the versionId. */
async function uploadAndSegment(h: ReturnType<typeof harness>, filename: string, bytes: Uint8Array): Promise<string> {
  const result = await uploadArtifact(h.uploadDeps, {
    orgId: ORG,
    projectId: PROJECT,
    agendaSegmentId: null,
    confidential: false,
    actorId: "u-1",
    files: [{ filename, bytes }],
  });
  const outcome = result.files[0]!;
  expect(outcome.status).toBe("accepted");
  if (outcome.status !== "accepted") throw new Error("unreachable");

  await h.outbox.enqueue({
    id: h.ids.next("job"),
    orgId: ORG,
    artifactId: outcome.artifactId,
    artifactVersionId: outcome.versionId,
    step: "EXTRACTED",
  });

  const extractedTick = await runIngestionWorkerTick(h.workerDeps, ORG, "worker-1");
  expect(extractedTick).toMatchObject({ claimed: true, step: "EXTRACTED" });

  const segmentedTick = await runIngestionWorkerTick(h.workerDeps, ORG, "worker-1");
  expect(segmentedTick).toMatchObject({ claimed: true, step: "SEGMENTED" });

  return outcome.versionId;
}

function segmentsOf(h: ReturnType<typeof harness>, versionId: string) {
  return [...h.repo.segments.values()]
    .filter((s) => s.artifactVersionId === versionId)
    .sort((a, b) => a.ordinal - b.ordinal);
}

describe("F37 -- Segment 锚点随模态而不同，每段都能回到原件的具体位置", () => {
  it("PDF/Office：anchor kind = 'page'，一页一个 Segment，页码从 1 开始", async () => {
    const h = harness();
    const versionId = await uploadAndSegment(h, "brief.pdf", pdfBytes(["page one", "page two", "page three"]));

    const segments = segmentsOf(h, versionId);
    expect(segments).toHaveLength(3);
    for (const s of segments) {
      expect(s.kind).toBe("text");
      expect(s.anchors).toHaveLength(1);
      expect(s.anchors[0]!.kind).toBe("page");
    }
    expect(segments.map((s) => s.anchors[0]!.locator)).toEqual(["1", "2", "3"]);
  });

  it("图片 OCR：anchor kind = 'image-region'，一个识别区域一个 Segment", async () => {
    const h = harness();
    const versionId = await uploadAndSegment(h, "scan.png", pngOcrBytes(["region A", "region B"]));

    const segments = segmentsOf(h, versionId);
    expect(segments).toHaveLength(2);
    for (const s of segments) {
      expect(s.anchors[0]!.kind).toBe("image-region");
    }
    expect(segments.map((s) => s.anchors[0]!.locator)).toEqual(["region-0", "region-1"]);
  });

  it("音视频 ASR：anchor kind = 'timecode'，每行转写各自的时间码", async () => {
    const h = harness();
    const versionId = await uploadAndSegment(
      h,
      "clip.wav",
      wavAsrBytes(["00:01 first line", "00:05 second line", "00:12 third line"]),
    );

    const segments = segmentsOf(h, versionId);
    expect(segments).toHaveLength(3);
    for (const s of segments) {
      expect(s.kind).toBe("audio-span");
      expect(s.anchors[0]!.kind).toBe("timecode");
    }
    expect(segments.map((s) => s.anchors[0]!.locator)).toEqual(["00:01", "00:05", "00:12"]);
  });

  it("CSV 结构化：anchor kind = 'question-no'，行号不含表头", async () => {
    const h = harness();
    const versionId = await uploadAndSegment(h, "responses.csv", csvBytes("question,answer", ["q1,yes", "q2,no", "q3,maybe"]));

    const segments = segmentsOf(h, versionId);
    expect(segments).toHaveLength(3);
    for (const s of segments) {
      expect(s.kind).toBe("answer");
      expect(s.anchors[0]!.kind).toBe("question-no");
    }
    expect(segments.map((s) => s.anchors[0]!.locator)).toEqual(["1", "2", "3"]);
  });

  it("JSONL 结构化：anchor kind = 'message-id'，locator 取自记录自己的 id 字段", async () => {
    const h = harness();
    const versionId = await uploadAndSegment(
      h,
      "messages.jsonl",
      jsonlBytes([
        { id: "m-1", text: "hi" },
        { id: "m-2", text: "hello back" },
      ]),
    );

    const segments = segmentsOf(h, versionId);
    expect(segments).toHaveLength(2);
    for (const s of segments) {
      expect(s.kind).toBe("message");
      expect(s.anchors[0]!.kind).toBe("message-id");
    }
    expect(segments.map((s) => s.anchors[0]!.locator)).toEqual(["m-1", "m-2"]);
  });

  it("反证：一个没有任何可辨认页/区域/时间码/行的空文件仍必须产出至少一个 anchored Segment（I-7 的前提）", async () => {
    const h = harness();
    // A single-line, comma-free, non-JSON text file: falls through to the document adapter's
    // degenerate case (no `\f` at all) -- still exactly one Segment, still anchored.
    const versionId = await uploadAndSegment(h, "empty-ish.txt", enc("just one line of prose"));

    const segments = segmentsOf(h, versionId);
    expect(segments.length).toBeGreaterThanOrEqual(1);
    expect(segments[0]!.anchors.length).toBeGreaterThanOrEqual(1);
  });
});
