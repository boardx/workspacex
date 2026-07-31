/**
 * F73 — 「录制产物物化为文件」, exercised against in-memory doubles (no PostgreSQL — see
 * `tests/support/artifact-fakes.ts`'s header and this worker's issue #74 constraint).
 *
 * Walks `CARRIERS` (the recording contract's own `SourceType` enum), not a hand-written list,
 * so a fourth carrier added to the contract fails `domain/recording/file-first.ts`'s own
 * `satisfies Record<SourceType, ...>` before it ever reaches this test.
 */
import { describe, expect, it } from "vitest";
import { CARRIERS } from "../../src/domain/recording/transcription-core";
import { originalFileOf, plannedRecordingFiles } from "../../src/domain/recording/file-first";
import {
  materializeSessionFiles,
  RecordingMaterializationFailedError,
} from "../../src/application/recording/materialize-file-first";
import { toOrgId } from "../../src/domain/org-id";
import { FakeArtifactRepository, FakeObjectStore, SequentialIdFactory, bytesFor } from "../support/artifact-fakes";

const ORG = toOrgId("org-f73");

function harness() {
  return { store: new FakeObjectStore(), repo: new FakeArtifactRepository(), ids: new SequentialIdFactory() };
}

function allParts() {
  return {
    "audio.webm": bytesFor("audio"),
    "transcript.jsonl": bytesFor("transcript"),
    "notes.md": bytesFor("notes"),
  };
}

describe("F73 file-first materialization — every carrier", () => {
  it("每种载体的转写稿都是必产文件 (transcript.jsonl required for every carrier)", () => {
    for (const carrier of CARRIERS) {
      const planned = plannedRecordingFiles(carrier, false);
      expect(planned.some((f) => f.fileName === "transcript.jsonl")).toBe(true);
    }
  });

  it("只有访谈载体额外产出 notes.md（user_visible_behavior 原话：「访谈另有 notes.md」）", () => {
    for (const carrier of CARRIERS) {
      const planned = plannedRecordingFiles(carrier, true);
      const hasNotes = planned.some((f) => f.fileName === "notes.md");
      expect(hasNotes).toBe(carrier === "interview");
    }
  });

  it("thread 载体没有音频这一路 —— 不是「未捕获」，是这个载体根本没有音频概念 (uc-5-1 R1)", () => {
    expect(plannedRecordingFiles("thread", true).some((f) => f.fileName === "audio.webm")).toBe(false);
    expect(originalFileOf("thread", true)).toBeUndefined();
  });

  it("workshop / interview 有音频时，音频是 original；没捕获音频时不产出零字节的音频文件", () => {
    expect(originalFileOf("workshop", true)?.fileName).toBe("audio.webm");
    expect(plannedRecordingFiles("workshop", false).some((f) => f.fileName === "audio.webm")).toBe(false);
  });

  it.each(CARRIERS)(
    "%s: 物化后每个计划内文件都成为一条独立 artifact + version（file browser 可见的单位）",
    async (carrier) => {
      const deps = harness();
      const hasAudio = carrier !== "thread";
      const parts = hasAudio ? allParts() : { "transcript.jsonl": bytesFor("transcript-thread") };

      const written = await materializeSessionFiles(deps, {
        orgId: ORG,
        projectId: "proj-1",
        sessionId: `sess-${carrier}`,
        sourceType: carrier,
        actorId: "user-1",
        parts,
      });

      const planned = plannedRecordingFiles(carrier, hasAudio);
      expect(written).toHaveLength(planned.length);

      // Every written file is its OWN artifact row — not bundled into one, which is the whole
      // reason the transcript can be `derivedFrom` the audio rather than hashed together with
      // it (see the header of `materialize-file-first.ts`).
      const artifactIds = new Set(written.map((w) => w.artifactId));
      expect(artifactIds.size).toBe(written.length);
      for (const w of written) {
        expect(deps.repo.artifacts.has(w.artifactId)).toBe(true);
        expect(deps.repo.versions.has(w.versionId)).toBe(true);
        // Actually downloadable: the object is really in the store, real bytes behind it (I-5's
        // recording-side counterpart).
        expect(await deps.store.get(w.objectStorageKey)).not.toBeNull();
      }
    },
  );

  it("缺文件即拒绝 —— 零字节视为「顶着文件名的缺失」，不静默生成空产物", async () => {
    const deps = harness();
    await expect(
      materializeSessionFiles(deps, {
        orgId: ORG,
        projectId: "proj-1",
        sessionId: "sess-missing",
        sourceType: "interview",
        actorId: "user-1",
        parts: { "audio.webm": bytesFor("audio"), "transcript.jsonl": new Uint8Array(0) },
      }),
    ).rejects.toThrow(RecordingMaterializationFailedError);
    // Nothing partially written: a failed validation must not leave any artifact behind.
    expect(deps.repo.artifacts.size).toBe(0);
  });
});
