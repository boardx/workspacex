/**
 * F37 -- the four content-extraction adapters (uc-22-2 R7, architecture 第七节门槛3).
 *
 * ## What this module is, and is not
 *
 * The EXTRACTED/SEGMENTED steps of the nine-state pipeline (F36) need to turn an original
 * file's BYTES into (a) an independent derived file that carries the extracted content, and
 * (b) a set of Segments, each anchored back to a concrete location in the original (a page,
 * a timecode, a message, an image region -- uc-22-2 R7's "每个 Segment 能回到原件").
 *
 * This module is the PURE, deterministic half of that: no I/O, no object store, no
 * PostgreSQL. Given bytes, it decides which of the four adapters applies and returns the
 * extracted text plus the segment/anchor structure. The impure half -- writing the derived
 * file and the segment rows -- lives in `ingestion-worker.ts`, which calls this and nothing
 * else decides content structure.
 *
 * ## Adapter selection is by SNIFFED bytes, never by filename/declared MIME
 *
 * `upload-artifact.ts`'s own materialization plan stores every upload under the generic
 * `application/octet-stream` MIME (`MATERIALIZATION_PLAN.upload`) -- the ORIGINAL's stored
 * MIME is deliberately not the real one (see that file). So by the time a worker reaches
 * this version, `artifact_versions.mime` cannot answer "which of the four adapters applies".
 * `domain/files/mime-sniff.ts`'s `sniffKind` already answers exactly that question from the
 * bytes themselves (V6's same "trust nothing but the bytes" rule, reused rather than
 * re-invented) -- this module only adds the finer-grained CSV vs. JSONL vs. plain-text split
 * `sniffKind` does not need for its own (security) purpose.
 *
 * ## The four adapters, and what each Segment's anchor means
 *
 *   pdf-office        PDF / Word / Excel / PowerPoint / plain text-ish documents.
 *                      Segment kind "text", anchor kind "page" -- content is split on the
 *                      form-feed page-break convention (`\f`), one Segment per page.
 *   image-ocr          Recognised text blocks lifted off an image.
 *                      Segment kind "text", anchor kind "image-region" -- one Segment per
 *                      recognised region (regions separated by a blank line in the OCR'd
 *                      text stream).
 *   audio-video-asr     A transcript with timecodes.
 *                      Segment kind "audio-span", anchor kind "timecode" -- one Segment per
 *                      transcript line, each line's own leading `mm:ss` becomes its anchor.
 *   csv-jsonl           Structured rows -- CSV survey-style tables or JSONL message logs.
 *                      CSV rows become Segment kind "answer" / anchor kind "question-no"
 *                      (the header + row number is the position); JSONL lines become
 *                      Segment kind "message" / anchor kind "message-id" (an `id` field if
 *                      present, else the 0-based line index).
 *
 * Every adapter also produces a derived-file kind (`DerivedKind`, `packages/contracts`):
 * `parsed-text` (pdf-office), `ocr` (image-ocr), `asr` (audio-video-asr), `structured`
 * (csv-jsonl). None of them is `embedding` -- I-6 requires all four be materialized as an
 * independent, downloadable object, never folded into the original.
 */
import { artifact as A } from "@repo/contracts";
import type { z } from "zod";
import { sniffKind } from "./mime-sniff";

// Domain is the innermost layer and may not import `application/artifact/ports` (that would
// be depending outward, ADR-020's onion) -- these three types are derived straight from the
// shared contract instead, the same way `application/artifact/ports.ts` itself derives them.
type AnchorKind = z.infer<typeof A.AnchorKind>;
type DerivedKind = z.infer<typeof A.DerivedKind>;
type SegmentKind = z.infer<typeof A.SegmentKind>;

export type AdapterKind = "pdf-office" | "image-ocr" | "audio-video-asr" | "csv-jsonl";

export interface ExtractedUnit {
  readonly segmentKind: SegmentKind;
  readonly anchorKind: AnchorKind;
  /** Interpreted per `anchorKind` -- page number / region id / timecode / message id / question no. */
  readonly locator: string;
  /** The unit's own extracted text -- not stored in `segments` (F04 stores structure, not
   *  bodies), but folded into the derived file's content so the extraction is inspectable. */
  readonly text: string;
}

export interface ExtractionResult {
  readonly adapter: AdapterKind;
  readonly derivedKind: DerivedKind;
  /** Full extracted content, in unit order -- what gets materialized as the derived file. */
  readonly derivedText: string;
  /** Never empty: an adapter that recognised nothing still emits one "(empty)" unit, because
   *  a version with zero segments cannot be searched OR cited back to (I-7's precondition). */
  readonly units: readonly [ExtractedUnit, ...ExtractedUnit[]];
  readonly generatorModel: string;
  readonly generatorVersion: string;
}

const DECODER = new TextDecoder("utf-8", { fatal: false });

function decodeText(bytes: Uint8Array): string {
  return DECODER.decode(bytes);
}

function nonEmptyUnits(units: readonly ExtractedUnit[], fallback: ExtractedUnit): readonly [ExtractedUnit, ...ExtractedUnit[]] {
  return units.length === 0 ? [fallback] : (units as readonly [ExtractedUnit, ...ExtractedUnit[]]);
}

/**
 * True iff `s` reads as real recognised content rather than binary noise decoded blind.
 *
 * `image-ocr`/`audio-video-asr` decode the WHOLE original buffer as text (there is no real
 * OCR/ASR engine here, only a deterministic stand-in -- see the module header), and that
 * buffer's leading bytes are the container format's own magic-byte header (PNG's 8-byte
 * signature, RIFF/WAVE's, etc.) -- binary, not content. A real engine would never emit a
 * "recognised region" that is actually a decoded magic-byte header; this is the stub's
 * equivalent check: any string containing the UTF-8 replacement character (an invalid byte
 * was decoded) or a control byte other than the whitespace ones is discarded rather than
 * surfacing a Segment whose "content" is a mis-decoded chunk of the file format's own header.
 */
function isPrintableText(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0xfffd) return false;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return false;
  }
  return true;
}

/** PDF/Office/plain-text: split on the page-break convention, one Segment per page. */
function extractPdfOffice(bytes: Uint8Array): ExtractionResult {
  const text = decodeText(bytes);
  const pages = text.split("\f").map((p) => p.trim());
  const nonEmptyPages = pages.filter((p) => p.length > 0);
  const units = nonEmptyUnits(
    nonEmptyPages.map((page, i) => ({
      segmentKind: "text" as const,
      anchorKind: "page" as const,
      locator: String(i + 1),
      text: page,
    })),
    { segmentKind: "text", anchorKind: "page", locator: "1", text: "" },
  );
  return {
    adapter: "pdf-office",
    derivedKind: "parsed-text",
    derivedText: units.map((u) => u.text).join("\f"),
    units,
    generatorModel: "deterministic-document-parser",
    generatorVersion: "1",
  };
}

/** Image OCR: blank-line-separated recognised regions. */
function extractImageOcr(bytes: Uint8Array): ExtractionResult {
  const text = decodeText(bytes);
  const regions = text.split(/\n\s*\n/).map((r) => r.trim());
  const nonEmptyRegions = regions.filter((r) => r.length > 0 && isPrintableText(r));
  const units = nonEmptyUnits(
    nonEmptyRegions.map((region, i) => ({
      segmentKind: "text" as const,
      anchorKind: "image-region" as const,
      locator: `region-${i}`,
      text: region,
    })),
    { segmentKind: "text", anchorKind: "image-region", locator: "region-0", text: "" },
  );
  return {
    adapter: "image-ocr",
    derivedKind: "ocr",
    derivedText: units.map((u) => u.text).join("\n\n"),
    units,
    generatorModel: "stub-ocr-engine",
    generatorVersion: "1",
  };
}

const TIMECODE_LINE = /^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)$/;

/** Audio/video ASR: one Segment per transcript line, anchored by that line's own timecode. */
function extractAudioVideoAsr(bytes: Uint8Array): ExtractionResult {
  const text = decodeText(bytes);
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && isPrintableText(l));
  const units: ExtractedUnit[] = [];
  lines.forEach((line, i) => {
    const m = TIMECODE_LINE.exec(line);
    units.push({
      segmentKind: "audio-span",
      anchorKind: "timecode",
      // A line with no recognisable timecode still gets one, derived from its position --
      // never a Segment with no way back to the recording (I-7).
      locator: m ? m[1]! : `00:${String(i).padStart(2, "0")}`,
      text: m ? m[2]! : line,
    });
  });
  const finalUnits = nonEmptyUnits(units, { segmentKind: "audio-span", anchorKind: "timecode", locator: "00:00", text: "" });
  return {
    adapter: "audio-video-asr",
    derivedKind: "asr",
    derivedText: finalUnits.map((u) => `${u.locator} ${u.text}`).join("\n"),
    units: finalUnits,
    generatorModel: "stub-asr-engine",
    generatorVersion: "1",
  };
}

function looksLikeJson(text: string): boolean {
  const t = text.trim();
  return t.startsWith("{") || t.startsWith("[");
}

function extractJsonl(text: string): ExtractionResult {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const units: ExtractedUnit[] = lines.map((line, i) => {
    let messageId = String(i);
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed !== null && typeof parsed === "object" && "id" in (parsed as Record<string, unknown>)) {
        const id = (parsed as Record<string, unknown>).id;
        if (typeof id === "string" || typeof id === "number") messageId = String(id);
      }
    } catch {
      // Not parseable JSON on this line -- fall back to the positional id. Still anchored,
      // never dropped (I-7).
    }
    return { segmentKind: "message" as const, anchorKind: "message-id" as const, locator: messageId, text: line };
  });
  const finalUnits = nonEmptyUnits(units, { segmentKind: "message", anchorKind: "message-id", locator: "0", text: "" });
  return {
    adapter: "csv-jsonl",
    derivedKind: "structured",
    derivedText: finalUnits.map((u) => u.text).join("\n"),
    units: finalUnits,
    generatorModel: "deterministic-structured-reader",
    generatorVersion: "1",
  };
}

function splitCsvLine(line: string): readonly string[] {
  return line.split(",").map((cell) => cell.trim());
}

function extractCsv(text: string): ExtractionResult {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const [header, ...rows] = lines;
  const columns = header !== undefined ? splitCsvLine(header) : [];
  const units: ExtractedUnit[] = rows.map((row, i) => {
    const cells = splitCsvLine(row);
    const paired = columns.map((c, ci) => `${c}=${cells[ci] ?? ""}`).join("; ");
    return {
      segmentKind: "answer" as const,
      anchorKind: "question-no" as const,
      // 1-based, and NOT counting the header row -- "question/row 1" is the first data row.
      locator: String(i + 1),
      text: paired.length > 0 ? paired : row,
    };
  });
  const finalUnits = nonEmptyUnits(units, { segmentKind: "answer", anchorKind: "question-no", locator: "1", text: "" });
  return {
    adapter: "csv-jsonl",
    derivedKind: "structured",
    derivedText: finalUnits.map((u) => u.text).join("\n"),
    units: finalUnits,
    generatorModel: "deterministic-structured-reader",
    generatorVersion: "1",
  };
}

/** CSV/JSONL structured extraction: dispatches on shape, not on filename (bytes-only, V6). */
function extractCsvJsonl(bytes: Uint8Array): ExtractionResult {
  const text = decodeText(bytes);
  if (looksLikeJson(text)) return extractJsonl(text);
  // A single comma-bearing header line with no JSON shape reads as CSV; anything else
  // (one column, no commas at all) still goes through the CSV path -- one Segment per line,
  // which is the CSV adapter's degenerate-but-correct case for a single-column file.
  return extractCsv(text);
}

/**
 * Bytes in, extraction out. Picks one of the four adapters by SNIFFING the bytes
 * (`sniffKind`, same technique `mime-sniff.ts` uses for the security check) -- never by
 * trusting a stored MIME or the original filename, neither of which is reliably available
 * to a worker several steps removed from the HTTP request that carried them (see header).
 */
export function runExtractionAdapter(bytes: Uint8Array): ExtractionResult {
  const sniffed = sniffKind(bytes);
  switch (sniffed) {
    case "png":
    case "jpeg":
    case "gif":
    case "webp":
      return extractImageOcr(bytes);
    case "mp3":
    case "wav":
    case "mp4":
      return extractAudioVideoAsr(bytes);
    case "pdf":
    case "zip": // docx/xlsx/pptx are zip containers (same treatment as `upload-limits.ts`)
      return extractPdfOffice(bytes);
    case "text":
    case "unknown":
    default: {
      const text = decodeText(bytes);
      const firstLine = text.split("\n")[0] ?? "";
      // Structured (CSV/JSONL) iff it is JSON-shaped OR its header row has a comma --
      // anything else (plain prose, one column, no commas at all) is a document, handled by
      // the document adapter rather than mis-filed as "structured".
      if (looksLikeJson(text) || firstLine.includes(",")) return extractCsvJsonl(bytes);
      return extractPdfOffice(bytes);
    }
  }
}
