/**
 * F35 -- MIME sniffing by actual bytes (uc-22-2 R3 step 5 ② / R7 / V6).
 *
 * ⚠ **Neither the file extension nor a `Content-Type` header is trusted.** Both are
 * attacker-controlled strings that happen to travel alongside the bytes; the only thing
 * that cannot lie about what a file is, is the file's own magic bytes. This module reads
 * ONLY the byte buffer -- callers must not pass it a `Content-Type` to "help".
 *
 * The signature table below is intentionally small (the families `upload-limits.ts`
 * whitelists) rather than a general-purpose sniffer. Anything not recognised sniffs to
 * `"unknown"`, which the whitelist above treats as an ALLOWED family only for the two
 * legacy OLE-based Office extensions (`.doc`/`.xls`/`.ppt`) -- everywhere else "unknown"
 * fails the cross-check, fail-closed.
 */

export type SniffedKind =
  | "pdf"
  | "png"
  | "jpeg"
  | "gif"
  | "webp"
  | "zip"
  | "mp3"
  | "wav"
  | "mp4"
  | "executable-pe"
  | "executable-elf"
  | "text"
  | "unknown";

/** Anything sniffed as one of these is a foreign-code container, never a document/media type. */
export const EXECUTABLE_KINDS: ReadonlySet<SniffedKind> = new Set(["executable-pe", "executable-elf"]);

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

/** True if the whole buffer looks like printable/UTF-8 text (no NUL, few control bytes). */
function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  if (sample.length === 0) return true;
  let control = 0;
  for (const b of sample) {
    if (b === 0) return false; // NUL is never valid UTF-8/ASCII text
    if (b < 0x09 || (b > 0x0d && b < 0x20)) control += 1;
  }
  return control / sample.length < 0.02;
}

/** Detect the real type of `bytes` from magic numbers alone. */
export function sniffKind(bytes: Uint8Array): SniffedKind {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif"; // GIF8
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x41, 0x56, 0x45], 8)) return "wav";
  if (startsWith(bytes, [0x49, 0x44, 0x33]) || startsWith(bytes, [0xff, 0xfb])) return "mp3"; // ID3 or MPEG frame
  if (bytes.length >= 12 && startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) return "mp4"; // ....ftyp
  // ZIP local-file-header / empty / spanned signatures -- also covers docx/xlsx/pptx, which
  // are zip containers, matching `MATERIALIZATION_PLAN`'s treatment of them elsewhere.
  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return "zip";
  }
  if (startsWith(bytes, [0x4d, 0x5a])) return "executable-pe"; // MZ -- Windows PE/DOS stub
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return "executable-elf"; // \x7fELF
  if (looksLikeText(bytes)) return "text";
  return "unknown";
}

export interface MimeSniffResult {
  readonly mismatch: boolean;
  readonly detected: SniffedKind;
}

/**
 * Cross-checks the sniffed kind against what the extension declares.
 *
 * An executable signature is a mismatch UNCONDITIONALLY -- V6 renames an executable to
 * `.pdf`; the detected kind is `executable-pe`/`executable-elf` and `expected` (`["pdf"]`)
 * never contains it, so this already rejects without a special case. The explicit
 * `EXECUTABLE_KINDS` check exists anyway so the refusal does not depend on every future
 * whitelist edit continuing to omit executables by omission alone.
 */
export function sniffAndCheck(filename: string, bytes: Uint8Array, expected: readonly string[] | undefined): MimeSniffResult {
  const detected = sniffKind(bytes);
  if (EXECUTABLE_KINDS.has(detected)) return { mismatch: true, detected };
  if (expected === undefined) return { mismatch: false, detected }; // extension not even whitelisted; caller's problem
  return { mismatch: !expected.includes(detected), detected };
}
