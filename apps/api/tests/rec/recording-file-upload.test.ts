import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { recording as C } from "@repo/contracts";
import { recordingUploadParts } from "../../src/application/recording/recording-file-upload";
const bytes = Buffer.from("1a45dfa38b4282847765626d1853806701020304", "hex");
const metadata = () => C.operations.materializeRecordingFiles.in.parse({ sessionId: "session", idempotencyKey: "attempt",
  audio: { contentType: "audio/webm", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } });
it("preserves explicit file bytes and UTF-8 notes, never accepting a raw object key", () => {
  expect(recordingUploadParts({ ...metadata(), notesMarkdown: "访谈笔记" }, { buffer: bytes, mimetype: "audio/webm" })).toEqual({
    "audio.webm": bytes, "notes.md": Buffer.from("访谈笔记") });
  expect(C.operations.materializeRecordingFiles.in.safeParse({ ...metadata(), objectKey: "other-session/audio" }).success).toBe(false);
});
it("rejects missing and undeclared file bytes", () => {
  expect(() => recordingUploadParts(metadata())).toThrow("INVALID_RECORDING_FILE");
  expect(() => recordingUploadParts({ sessionId: "session", idempotencyKey: "attempt" }, { buffer: bytes, mimetype: "audio/webm" })).toThrow("INVALID_RECORDING_FILE");
});
it("rejects claimed MIME, hash, length and non-WebM bytes before storage", () => {
  const file = { buffer: bytes, mimetype: "audio/webm" };
  expect(() => recordingUploadParts(metadata(), { ...file, mimetype: "video/webm" })).toThrow("INVALID_RECORDING_FILE");
  for (const patch of [{ sizeBytes: bytes.length + 1 }, { sha256: "0".repeat(64) }]) {
    const request = metadata(); expect(() => recordingUploadParts({ ...request, audio: { ...request.audio!, ...patch } }, file)).toThrow("INVALID_RECORDING_FILE");
  }
  expect(() => recordingUploadParts(metadata(), { ...file, buffer: Buffer.from([0]) })).toThrow("INVALID_RECORDING_FILE");
});
it("preserves the no-audio request and bounds metadata at the contract", () => {
  expect(recordingUploadParts({ sessionId: "session", idempotencyKey: "attempt" })).toEqual({});
  const request = metadata();
  expect(C.operations.materializeRecordingFiles.in.safeParse({ ...request, audio: { ...request.audio!, sizeBytes: 20 * 1024 * 1024 + 1 } }).success).toBe(false);
});
