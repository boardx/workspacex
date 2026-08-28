/**
 * DA-15 —— 文件事件命名空间扩展的契约测试。
 *
 * 只测 zod 校验层本身（合法 payload 通过、非法 payload 被拒），不假装有真实事件流
 * 跑通——生产端（DA-13/DA-16）还没落地，见 `agui-state-events.ts` 本段文件头。
 */
import { describe, expect, it } from "vitest";
import {
  AGUI_FILE_DOMAINS,
  AGUI_FILE_EVENT_NAME,
  AguiFileCreatedValue,
  AguiFileContentDeltaValue,
  AguiFilePatchAppliedValue,
  AguiFileSource,
  parseAguiFileCreatedValue,
  parseAguiFileContentDeltaValue,
  parseAguiFilePatchAppliedValue,
  parseVfsUriString,
} from "../src/agui-state-events";

describe("DA-15 file event contract", () => {
  it("event name constants are the three backlog-specified literals", () => {
    expect(AGUI_FILE_EVENT_NAME).toEqual({
      FILE_CREATED: "file_created",
      FILE_CONTENT_DELTA: "file_content_delta",
      FILE_PATCH_APPLIED: "file_patch_applied",
    });
  });

  it("mirrors vfs-uri.ts's VFS_DOMAINS exactly (two-declaration discipline)", () => {
    // apps/api/src/domain/vfs/vfs-uri.ts:
    //   export const VFS_DOMAINS = ["attachment", "artifact"] as const;
    // This is the mechanical cross-check the file header comment calls for --
    // if that array ever changes, this assertion goes red and forces the sync.
    expect(AGUI_FILE_DOMAINS).toEqual(["attachment", "artifact"]);
  });

  describe("AguiFileCreatedValue / file_created", () => {
    const valid = {
      uri: "vfs://attachment/att_123",
      domain: "attachment" as const,
      name: "report.pdf",
      mime: "application/pdf",
      bytes: 4096,
      source: "chat_upload" as const,
    };

    it("accepts a valid payload", () => {
      const result = AguiFileCreatedValue.safeParse(valid);
      expect(result.success).toBe(true);
      expect(parseAguiFileCreatedValue(valid)).toEqual(valid);
    });

    it("accepts null mime/bytes (metadata genuinely unknown)", () => {
      const withNulls = { ...valid, mime: null, bytes: null };
      expect(AguiFileCreatedValue.safeParse(withNulls).success).toBe(true);
    });

    it("accepts artifact domain with artifact_pin source", () => {
      const artifactCase = {
        uri: "vfs://artifact/art_789",
        domain: "artifact" as const,
        name: "访谈纪要",
        mime: null,
        bytes: null,
        source: "artifact_pin" as const,
      };
      expect(AguiFileCreatedValue.safeParse(artifactCase).success).toBe(true);
    });

    it("rejects a non-vfs:// uri", () => {
      const bad = { ...valid, uri: "https://example.com/att_123" };
      expect(AguiFileCreatedValue.safeParse(bad).success).toBe(false);
      expect(parseAguiFileCreatedValue(bad)).toBeNull();
    });

    it("rejects a vfs uri with an unknown domain", () => {
      const bad = { ...valid, uri: "vfs://widget/att_123" };
      expect(AguiFileCreatedValue.safeParse(bad).success).toBe(false);
    });

it("does NOT cross-check domain/uri agreement at this layer (documented gap)", () => {
      // The schema validates uri shape and domain enum independently -- it does not
      // cross-check that the uri's domain segment matches the `domain` field. That
      // cross-check belongs to parseVfsUri (apps/api), the authoritative parser this
      // file explicitly does not duplicate (see file header). Documented here so the
      // gap is a decision, not an oversight.
      const mismatched = { ...valid, uri: "vfs://artifact/art_1", domain: "attachment" as const };
      expect(AguiFileCreatedValue.safeParse(mismatched).success).toBe(true);
    });

    it("rejects a blank name", () => {
      const bad = { ...valid, name: "   " };
      expect(AguiFileCreatedValue.safeParse(bad).success).toBe(false);
    });

    it("rejects a negative byte count", () => {
      const bad = { ...valid, bytes: -1 };
      expect(AguiFileCreatedValue.safeParse(bad).success).toBe(false);
    });

    it("rejects an unknown source", () => {
      const bad = { ...valid, source: "teleported_in" };
      expect(AguiFileCreatedValue.safeParse(bad).success).toBe(false);
    });

    it("rejects a missing required field", () => {
      const { source: _drop, ...bad } = valid;
      expect(AguiFileCreatedValue.safeParse(bad).success).toBe(false);
    });
  });

  describe("AguiFileContentDeltaValue / file_content_delta", () => {
    const valid = { uri: "vfs://attachment/att_1", delta: "第一段增量文本", sequence: 0 };

    it("accepts a valid payload", () => {
      expect(AguiFileContentDeltaValue.safeParse(valid).success).toBe(true);
      expect(parseAguiFileContentDeltaValue(valid)).toEqual(valid);
    });

    it("accepts an empty-string delta (a real but empty chunk)", () => {
      expect(AguiFileContentDeltaValue.safeParse({ ...valid, delta: "" }).success).toBe(true);
    });

    it("rejects a negative sequence", () => {
      expect(AguiFileContentDeltaValue.safeParse({ ...valid, sequence: -1 }).success).toBe(false);
    });

    it("rejects a non-integer sequence", () => {
      expect(AguiFileContentDeltaValue.safeParse({ ...valid, sequence: 1.5 }).success).toBe(false);
    });

    it("rejects a malformed uri", () => {
      const bad = { ...valid, uri: "not-a-uri" };
      expect(AguiFileContentDeltaValue.safeParse(bad).success).toBe(false);
      expect(parseAguiFileContentDeltaValue(bad)).toBeNull();
    });
  });

  describe("AguiFilePatchAppliedValue / file_patch_applied", () => {
    const unifiedDiff = [
      "--- a/report.md",
      "+++ b/report.md",
      "@@ -1 +1 @@",
      "-old line",
      "+new line",
      "",
    ].join("\n");
    const valid = { uri: "vfs://artifact/art_1", patch: unifiedDiff, summary: "修正一处措辞" };

    it("accepts a valid payload", () => {
      expect(AguiFilePatchAppliedValue.safeParse(valid).success).toBe(true);
      expect(parseAguiFilePatchAppliedValue(valid)).toEqual(valid);
    });

    it("accepts a null summary (producer genuinely has none)", () => {
      expect(AguiFilePatchAppliedValue.safeParse({ ...valid, summary: null }).success).toBe(true);
    });

    it("rejects a blank patch", () => {
      const bad = { ...valid, patch: "   " };
      expect(AguiFilePatchAppliedValue.safeParse(bad).success).toBe(false);
      expect(parseAguiFilePatchAppliedValue(bad)).toBeNull();
    });

    it("rejects a missing patch field", () => {
      const { patch: _drop, ...bad } = valid;
      expect(AguiFilePatchAppliedValue.safeParse(bad).success).toBe(false);
    });
  });

  it("AguiFileSource enumerates exactly the three known VFS write paths", () => {
    expect(AguiFileSource.options).toEqual(["chat_upload", "agent_run_output", "artifact_pin"]);
  });

  // issue #2321 round 4 -- `active-file-panel.tsx`'s download card needs the reverse
  // direction: pull the raw attachment id back out of a `vfs://attachment/<id>` uri to
  // build the existing `GET /chat/threads/:threadId/attachments/:id/content` route.
  describe("parseVfsUriString", () => {
    it("splits a valid attachment uri into domain + id", () => {
      expect(parseVfsUriString("vfs://attachment/att_123")).toEqual({ domain: "attachment", id: "att_123" });
    });

    it("splits a valid artifact uri into domain + id", () => {
      expect(parseVfsUriString("vfs://artifact/artifact-abc-1")).toEqual({ domain: "artifact", id: "artifact-abc-1" });
    });

    it.each([
      ["wrong scheme", "http://attachment/att_123"],
      ["unknown domain", "vfs://document/att_123"],
      ["missing id", "vfs://attachment/"],
      ["id with a slash", "vfs://attachment/att/123"],
      ["not a uri at all", "att_123"],
    ])("returns null, not a guess, for: %s", (_name, input) => {
      expect(parseVfsUriString(input)).toBeNull();
    });
  });
});
