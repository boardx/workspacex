import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WHITEBOARD_IMPORT_LIMITS } from "../src/whiteboard-import";
import { PortableFile } from "../src/whiteboard-portable";

describe("portable whiteboard file envelope", () => {
  it("accepts the canonical base64 representation of the maximum allowed file", () => {
    const bytes = Buffer.alloc(WHITEBOARD_IMPORT_LIMITS.uploadBytes);
    const contentBase64 = bytes.toString("base64");

    const envelope = {
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      contentBase64,
    };

    expect(PortableFile.safeParse(envelope).success).toBe(true);
    expect(
      PortableFile.safeParse({ ...envelope, contentBase64: `${contentBase64}AAAA` }).success,
    ).toBe(false);
  });
});
