/**
 * F37 -- the four extraction adapters (uc-22-2 R7, architecture 第七节门槛3): PDF/Office
 * parsing, image OCR, audio/video ASR, CSV/JSONL structured reading. Each must produce an
 * INDEPENDENT derived file that never overwrites the original (I-6).
 *
 * Against in-memory doubles, per this worker's no-local-Postgres constraint (issue #74).
 * Drives the real EXTRACTED step (`ingestion-worker.ts`'s `runIngestionWorkerTick`) end to
 * end -- `domain/files/extraction-adapters.ts` is exercised through the pipeline that
 * actually calls it, not in isolation, so a wiring mistake between the two would show up
 * here even if the pure adapter functions were individually correct.
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { uploadArtifact, type UploadArtifactDeps } from "../../src/application/files/upload-artifact";
import { replayIngestionRun, type IngestionWorkerDeps } from "../../src/application/files/ingestion-worker";
import type { QuarantineRepository, SecurityAlertPort } from "../../src/application/files/upload-ports";
import { FakeArtifactRepository, FakeObjectStore, SequentialIdFactory } from "../support/artifact-fakes";
import { InMemoryIngestionOutbox } from "../support/ingestion-outbox-fakes";

const ORG = toOrgId("org-f37-adapters");
const PROJECT = "proj-f37-adapters";

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

/** `%PDF` magic (itself plain ASCII) + page-break-separated text -- sniffs as "pdf". */
function pdfBytes(pages: readonly string[]): Uint8Array {
  return enc(`%PDF-1.4\n${pages.join("\f")}`);
}

/** PNG signature + blank-line-separated OCR'd regions -- sniffs as "png". */
function pngOcrBytes(regions: readonly string[]): Uint8Array {
  const magic = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return concat(magic, enc(`\n${regions.join("\n\n")}`));
}

/** RIFF/WAVE header (size field zeroed -- valid single-byte code points) + transcript lines. */
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

async function uploadAndRunExtracted(h: ReturnType<typeof harness>, filename: string, bytes: Uint8Array) {
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

  // `FakeArtifactRepository` (unlike `PgArtifactRepository`) does not itself wire the
  // outbox row on `createVersion` -- enqueue the first step by hand, same as the real
  // repository's `enqueueIngestionOutboxStep` branch does inside its own transaction.
  await h.outbox.enqueue({
    id: h.ids.next("job"),
    orgId: ORG,
    artifactId: outcome.artifactId,
    artifactVersionId: outcome.versionId,
    step: "EXTRACTED",
  });

  // `replayIngestionRun` claims THIS version's job specifically (`claimForVersion`), unlike
  // `runIngestionWorkerTick`'s "whatever the queue offers next" -- several files can be
  // in flight in the same harness (the counter-proof test below uploads four), and this
  // must not accidentally advance a DIFFERENT file's leftover job instead.
  const tick = await replayIngestionRun(h.workerDeps, ORG, outcome.versionId, "worker-1");
  expect(tick).toMatchObject({ claimed: true, step: "EXTRACTED" });

  return outcome;
}

describe("F37 -- 四类 adapter：抽取内容落成独立派生文件，不覆盖原件", () => {
  it("PDF/Office 解析 -> derivedKind='parsed-text'", async () => {
    const h = harness();
    const bytes = pdfBytes(["first page of the document", "second page follows"]);
    const outcome = await uploadAndRunExtracted(h, "brief.pdf", bytes);

    const derived = [...h.repo.derived.values()];
    expect(derived).toHaveLength(1);
    expect(derived[0]!.kind).toBe("parsed-text");
    expect(derived[0]!.derivedFrom).toBe(outcome.versionId);
    expect(derived[0]!.generatorModel.length).toBeGreaterThan(0);
    expect(derived[0]!.generatorVersion.length).toBeGreaterThan(0);
    expect(derived[0]!.objectStorageKey).not.toBe(null);

    const original = h.repo.versions.get(outcome.versionId)!;
    // I-6: the derived object lives at a DIFFERENT key from the original, and the
    // original's own bytes are untouched.
    expect(derived[0]!.objectStorageKey).not.toBe(original.objectStorageKey);
    expect(await h.store.get(original.objectStorageKey)).toEqual(bytes);
  });

  it("图片 OCR -> derivedKind='ocr'", async () => {
    const h = harness();
    const bytes = pngOcrBytes(["recognised block one", "recognised block two"]);
    const outcome = await uploadAndRunExtracted(h, "scan.png", bytes);

    const derived = [...h.repo.derived.values()];
    expect(derived).toHaveLength(1);
    expect(derived[0]!.kind).toBe("ocr");
    const original = h.repo.versions.get(outcome.versionId)!;
    expect(await h.store.get(original.objectStorageKey)).toEqual(bytes);
  });

  it("音视频 ASR -> derivedKind='asr'", async () => {
    const h = harness();
    const bytes = wavAsrBytes(["00:01 hello there", "00:05 general kenobi"]);
    const outcome = await uploadAndRunExtracted(h, "clip.wav", bytes);

    const derived = [...h.repo.derived.values()];
    expect(derived).toHaveLength(1);
    expect(derived[0]!.kind).toBe("asr");
    const original = h.repo.versions.get(outcome.versionId)!;
    expect(await h.store.get(original.objectStorageKey)).toEqual(bytes);
  });

  it("CSV 结构化读取 -> derivedKind='structured'", async () => {
    const h = harness();
    const bytes = csvBytes("question,answer", ["q1,yes", "q2,no"]);
    const outcome = await uploadAndRunExtracted(h, "responses.csv", bytes);

    const derived = [...h.repo.derived.values()];
    expect(derived).toHaveLength(1);
    expect(derived[0]!.kind).toBe("structured");
    const original = h.repo.versions.get(outcome.versionId)!;
    expect(await h.store.get(original.objectStorageKey)).toEqual(bytes);
  });

  it("JSONL 结构化读取（消息日志）也落到 derivedKind='structured'", async () => {
    const h = harness();
    const bytes = jsonlBytes([{ id: "m1", text: "hi" }, { id: "m2", text: "hello back" }]);
    const outcome = await uploadAndRunExtracted(h, "messages.jsonl", bytes);

    const derived = [...h.repo.derived.values()];
    expect(derived).toHaveLength(1);
    expect(derived[0]!.kind).toBe("structured");
  });

  it("反证：如果四类 adapter 共享同一份派生文件路径，第二类文件的派生 kind 就会互相冲突", async () => {
    // Not a hypothetical -- upload one of each kind into the SAME harness and confirm each
    // gets its OWN derived row with its OWN kind, none clobbering another.
    const h = harness();
    await uploadAndRunExtracted(h, "a.pdf", pdfBytes(["only page"]));
    await uploadAndRunExtracted(h, "b.png", pngOcrBytes(["only region"]));
    await uploadAndRunExtracted(h, "c.wav", wavAsrBytes(["00:00 only line"]));
    await uploadAndRunExtracted(h, "d.csv", csvBytes("question,answer", ["only-row,yes"]));

    const kinds = [...h.repo.derived.values()].map((d) => d.kind).sort();
    expect(kinds).toEqual(["asr", "ocr", "parsed-text", "structured"]);
  });
});
