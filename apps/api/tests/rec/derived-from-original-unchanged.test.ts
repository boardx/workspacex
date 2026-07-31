/**
 * F73 — 「转写稿带 derived_from 指回原音频 artifact_version，原音频 SHA-256 不变」
 * (uc-5-1 R10, this feature's `user_visible_behavior` verbatim).
 *
 * Against in-memory doubles, per this worker's no-local-Postgres constraint (issue #74) —
 * `tests/support/artifact-fakes.ts` keeps real per-key bytes and real per-version rows, so
 * "the audio's hash did not move" is read back from the fake rather than asserted about a
 * value the test itself computed and never round-tripped.
 */
import { describe, expect, it } from "vitest";
import { computeContentHash } from "../../src/domain/artifact/content-hash";
import { materializeSessionFiles } from "../../src/application/recording/materialize-file-first";
import { toOrgId } from "../../src/domain/org-id";
import { FakeArtifactRepository, FakeObjectStore, SequentialIdFactory, bytesFor } from "../support/artifact-fakes";

const ORG = toOrgId("org-f73-derived");

function harness() {
  return { store: new FakeObjectStore(), repo: new FakeArtifactRepository(), ids: new SequentialIdFactory() };
}

describe("F73 derived_from — transcript points back to the original audio, audio never changes", () => {
  it("转写稿与 notes 的 derivedFrom 都指回音频 version id；音频自己的 derivedFrom 为 null", async () => {
    const deps = harness();
    const written = await materializeSessionFiles(deps, {
      orgId: ORG,
      projectId: "proj-1",
      sessionId: "sess-1",
      sourceType: "interview",
      actorId: "user-1",
      parts: {
        "audio.webm": bytesFor("audio-sess-1"),
        "transcript.jsonl": bytesFor("transcript-sess-1"),
        "notes.md": bytesFor("notes-sess-1"),
      },
    });

    const audio = written.find((w) => w.fileName === "audio.webm")!;
    const transcript = written.find((w) => w.fileName === "transcript.jsonl")!;
    const notes = written.find((w) => w.fileName === "notes.md")!;

    expect(audio.derivedFrom).toBeNull();
    expect(transcript.derivedFrom).toBe(audio.versionId);
    expect(notes.derivedFrom).toBe(audio.versionId);

    // And the repository row itself agrees — not just the use case's return value.
    expect(deps.repo.versions.get(transcript.versionId)!.derivedFrom).toBe(audio.versionId);
    expect(deps.repo.versions.get(notes.versionId)!.derivedFrom).toBe(audio.versionId);
    expect(deps.repo.versions.get(audio.versionId)!.derivedFrom).toBeNull();
  });

  it("原始音频的 SHA-256 在转写稿/notes 物化之后逐字节不变", async () => {
    const deps = harness();
    const audioBytes = bytesFor("audio-hash-check");
    const expectedHash = computeContentHash(audioBytes);

    const written = await materializeSessionFiles(deps, {
      orgId: ORG,
      projectId: "proj-1",
      sessionId: "sess-2",
      sourceType: "interview",
      actorId: "user-1",
      parts: {
        "audio.webm": audioBytes,
        "transcript.jsonl": bytesFor("transcript-sess-2"),
        "notes.md": bytesFor("notes-sess-2"),
      },
    });
    const audio = written.find((w) => w.fileName === "audio.webm")!;

    // The version row's recorded hash...
    expect(audio.contentHash).toBe(expectedHash);
    expect(deps.repo.versions.get(audio.versionId)!.contentHash).toBe(expectedHash);

    // ...and the bytes actually sitting in the object store at that key, re-hashed after the
    // transcript and notes were subsequently written to DIFFERENT keys. Nothing here special-
    // cases "check right after write" — this re-reads after the derived files exist.
    const backAgain = await deps.store.get(audio.objectStorageKey);
    expect(backAgain).not.toBeNull();
    expect(computeContentHash(backAgain!)).toBe(expectedHash);
  });

  it("没有音频的载体（thread）：转写稿是自己的 original，derivedFrom 为 null，不是「待补」", async () => {
    const deps = harness();
    const written = await materializeSessionFiles(deps, {
      orgId: ORG,
      projectId: "proj-1",
      sessionId: "sess-thread",
      sourceType: "thread",
      actorId: "user-1",
      parts: { "transcript.jsonl": bytesFor("transcript-thread-only") },
    });
    expect(written).toHaveLength(1);
    expect(written[0]!.fileName).toBe("transcript.jsonl");
    expect(written[0]!.derivedFrom).toBeNull();
  });

  it("同一次调用产出的音频与转写稿是两个不同的 artifact/version —— 不是被打包进同一个版本", async () => {
    const deps = harness();
    const written = await materializeSessionFiles(deps, {
      orgId: ORG,
      projectId: "proj-1",
      sessionId: "sess-3",
      sourceType: "interview",
      actorId: "user-1",
      parts: {
        "audio.webm": bytesFor("audio-sess-3"),
        "transcript.jsonl": bytesFor("transcript-sess-3"),
        "notes.md": bytesFor("notes-sess-3"),
      },
    });
    const audio = written.find((w) => w.fileName === "audio.webm")!;
    const transcript = written.find((w) => w.fileName === "transcript.jsonl")!;

    expect(audio.artifactId).not.toBe(transcript.artifactId);
    expect(audio.versionId).not.toBe(transcript.versionId);
    expect(audio.contentHash).not.toBe(transcript.contentHash);
  });
});
