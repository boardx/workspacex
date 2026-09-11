import { createHash } from "node:crypto";
import { recording as C } from "@repo/contracts";

export type RecordingFileRequest = typeof C.operations.materializeRecordingFiles.in._type;
export function recordingUploadParts(input: RecordingFileRequest, audio?: { buffer: Uint8Array; mimetype: string }) {
  if (Boolean(input.audio) !== Boolean(audio)) throw new Error("INVALID_RECORDING_FILE");
  const parts: { "audio.webm"?: Uint8Array; "notes.md"?: Uint8Array } = {};
  if (audio && input.audio) {
    const bytes = audio.buffer;
    // WebM's EBML container header plus declared WebM DocType, not just a filename/MIME.
    // Bounded scan avoids interpreting the media payload as metadata.
    const header = Buffer.from(bytes.subarray(0, Math.min(4096, bytes.length)));
    if (audio.mimetype !== input.audio.contentType || bytes.byteLength !== input.audio.sizeBytes ||
      bytes.byteLength > C.operations.materializeRecordingFiles.in.shape.audio.unwrap().shape.sizeBytes.maxValue! ||
      header.length < 11 || header.readUInt32BE(0) !== 0x1a45dfa3 || !header.includes(Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d])) ||
      createHash("sha256").update(bytes).digest("hex") !== input.audio.sha256) throw new Error("INVALID_RECORDING_FILE");
    parts["audio.webm"] = bytes;
  }
  if (input.notesMarkdown !== undefined) parts["notes.md"] = Buffer.from(input.notesMarkdown, "utf8");
  return parts;
}
