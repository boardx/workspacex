/**
 * F35 -- zip-bomb detection without full decompression (uc-22-2 R3 step 5 ③ / E1 / V5).
 *
 * ## What "without full decompression" actually means here
 *
 * A zip bomb's whole trick is that its OWN declared sizes cannot be trusted -- so this does
 * not stop at reading the Central Directory's `uncompressed size` field (an attacker
 * controls that number too). It inflates each entry through a real streaming
 * `zlib.createInflateRaw()`, counts bytes as they come out, and calls `.destroy()` on the
 * inflater the INSTANT the running total crosses `limits.maxDecompressedBytes` -- the
 * stream is torn down mid-inflate, never fed to completion. That is what makes "worker
 * memory/disk usage does not exceed the threshold" (V5) true rather than asserted: the
 * process never holds more than `limit + one chunk` of decompressed bytes at once,
 * regardless of how large the archive claims (or turns out) to be.
 *
 * The Central Directory record sizes ARE read first, as a fast pre-check: if the entry
 * count or the DECLARED total already exceeds the cap, this rejects before inflating a
 * single byte. That is a legitimate optimisation, not the safety property -- the property
 * is the streaming abort, which is why it stays in place even when the declared numbers
 * look fine.
 *
 * ## Nesting depth
 *
 * True recursive unzip-of-unzip is out of scope for this pass (flagged as a gap in the PR):
 * nesting is counted STRUCTURALLY, by entry name (an entry whose name itself ends in a
 * known archive extension counts as one nested level). That is enough to fail closed on the
 * shape of attack R7/R10 names ("嵌套层数") without this feature growing a recursive
 * decompressor of arbitrary depth.
 */
import { createInflateRaw } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
/** EOCD comment is at most 65535 bytes; search no further back than that + the record itself. */
const EOCD_MAX_SEARCH = EOCD_MIN_SIZE + 65_535;

const NESTED_ARCHIVE_EXTENSIONS = [".zip", ".rar", ".7z", ".tar", ".gz", ".tgz"];

export interface ZipBombLimits {
  readonly maxEntries: number;
  readonly maxDecompressedBytes: number;
  readonly maxNestingDepth: number;
}

export type ZipBombReason =
  | { readonly kind: "entry-count-exceeded"; readonly actual: number; readonly limit: number }
  | { readonly kind: "decompressed-size-exceeded"; readonly actual: number; readonly limit: number }
  | { readonly kind: "nesting-depth-exceeded"; readonly actual: number; readonly limit: number }
  | { readonly kind: "malformed-archive" };

export interface ZipInspection {
  readonly ok: boolean;
  readonly entryCount: number;
  /** Bytes actually produced before any abort -- NOT a full decompression when `ok` is false. */
  readonly inspectedDecompressedBytes: number;
  readonly reason: ZipBombReason | null;
}

/** Cheap signature check -- does `bytes` look like a zip container at all? */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  );
}

interface CentralDirectoryEntry {
  readonly filename: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly compressionMethod: number;
  readonly localHeaderOffset: number;
}

/** Finds the End Of Central Directory record and returns entry count + CD offset, or null. */
function findEocd(buf: Buffer): { entryCount: number; cdOffset: number; cdSize: number } | null {
  const start = Math.max(0, buf.length - EOCD_MAX_SEARCH);
  for (let i = buf.length - EOCD_MIN_SIZE; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      const entryCount = buf.readUInt16LE(i + 10);
      const cdSize = buf.readUInt32LE(i + 12);
      const cdOffset = buf.readUInt32LE(i + 16);
      return { entryCount, cdOffset, cdSize };
    }
  }
  return null;
}

function readCentralDirectory(buf: Buffer, cdOffset: number, entryCount: number): CentralDirectoryEntry[] {
  const entries: CentralDirectoryEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_DIRECTORY_SIGNATURE) break;
    const compressionMethod = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const filenameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const filename = buf.subarray(p + 46, p + 46 + filenameLen).toString("utf8");
    entries.push({ filename, compressedSize, uncompressedSize, compressionMethod, localHeaderOffset });
    p += 46 + filenameLen + extraLen + commentLen;
  }
  return entries;
}

/** Locates entry `e`'s compressed data inside `buf`, reading only the LOCAL header's own lengths. */
function localFileData(buf: Buffer, e: CentralDirectoryEntry): Buffer | null {
  const p = e.localHeaderOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== LOCAL_FILE_HEADER_SIGNATURE) return null;
  const filenameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const dataStart = p + 30 + filenameLen + extraLen;
  const dataEnd = dataStart + e.compressedSize;
  if (dataEnd > buf.length) return null;
  return buf.subarray(dataStart, dataEnd);
}

/**
 * How much COMPRESSED input is handed to zlib per `write()`. This, not the abort check
 * alone, is what bounds worst-case memory: Node's zlib binding decompresses one `write()`
 * call's input in a single synchronous native pass and pushes every output chunk it
 * produces before yielding back to JS, so a `.destroy()` called from a `"data"` handler
 * does not interrupt output already being produced from bytes already handed over -- it
 * only stops FUTURE input from being fed in. Keeping each feed small (compressed bytes,
 * not decompressed bytes) is therefore the actual safety property: even at a 1000:1 ratio,
 * one 2 KiB compressed chunk cannot expand past roughly 2 MiB before the running total is
 * checked again and feeding stops.
 */
const INFLATE_FEED_CHUNK_BYTES = 2 * 1024;

/**
 * Inflates `compressed` through a real stream, feeding it in small compressed-byte
 * increments and stopping (never feeding the rest) the instant the running total
 * (starting from `alreadyCounted`) would cross `cap`. Returns bytes actually produced and
 * whether it was torn down early -- i.e. NOT fully decompressed.
 */
function inflateWithCap(compressed: Buffer, alreadyCounted: number, cap: number): Promise<{ bytes: number; aborted: boolean }> {
  return new Promise((resolvePromise) => {
    const inflater = createInflateRaw();
    let total = 0;
    let aborted = false;
    let settled = false;
    let offset = 0;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolvePromise({ bytes: total, aborted });
    };

    inflater.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (!aborted && alreadyCounted + total > cap) {
        aborted = true;
        // Stops the FEED (see `feed()` below); does not claim to interrupt output already
        // produced from bytes already written, which is why the feed chunk stays small.
        inflater.destroy();
      }
    });
    inflater.on("close", finish);
    inflater.on("error", finish);

    function feed(): void {
      if (aborted || settled) return;
      if (offset >= compressed.length) {
        inflater.end();
        return;
      }
      const slice = compressed.subarray(offset, Math.min(offset + INFLATE_FEED_CHUNK_BYTES, compressed.length));
      offset += slice.length;
      const canWriteMore = inflater.write(slice);
      // Yielding back to the event loop between writes (rather than looping synchronously)
      // is what gives the "data" handler above a chance to see the total and set `aborted`
      // BEFORE the next chunk is fed -- a synchronous `for` loop over `write()` calls would
      // queue every write before a single "data" event had a chance to run.
      if (canWriteMore) setImmediate(feed);
      else inflater.once("drain", feed);
    }
    feed();
  });
}

/**
 * Inspects a candidate zip archive for bomb characteristics WITHOUT fully decompressing it
 * when the answer is "reject". See file header for what that guarantees.
 */
export async function inspectZipForBomb(bytes: Uint8Array, limits: ZipBombLimits): Promise<ZipInspection> {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(buf);
  if (eocd === null) {
    return { ok: false, entryCount: 0, inspectedDecompressedBytes: 0, reason: { kind: "malformed-archive" } };
  }

  if (eocd.entryCount > limits.maxEntries) {
    return {
      ok: false,
      entryCount: eocd.entryCount,
      inspectedDecompressedBytes: 0,
      reason: { kind: "entry-count-exceeded", actual: eocd.entryCount, limit: limits.maxEntries },
    };
  }

  const entries = readCentralDirectory(buf, eocd.cdOffset, eocd.entryCount);

  let nestingDepth = 0;
  for (const e of entries) {
    const lower = e.filename.toLowerCase();
    if (NESTED_ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext))) nestingDepth += 1;
  }
  if (nestingDepth > limits.maxNestingDepth) {
    return {
      ok: false,
      entryCount: entries.length,
      inspectedDecompressedBytes: 0,
      reason: { kind: "nesting-depth-exceeded", actual: nestingDepth, limit: limits.maxNestingDepth },
    };
  }

  // Fast pre-check on DECLARED sizes -- an optimisation, not the safety property (see header).
  const declaredTotal = entries.reduce((sum, e) => sum + e.uncompressedSize, 0);
  if (declaredTotal > limits.maxDecompressedBytes) {
    return {
      ok: false,
      entryCount: entries.length,
      inspectedDecompressedBytes: 0,
      reason: {
        kind: "decompressed-size-exceeded",
        actual: declaredTotal,
        limit: limits.maxDecompressedBytes,
      },
    };
  }

  // Declared sizes looked fine (or method 0 = store, where "declared" IS actual). Still
  // stream-inflate for real, because the declared field is the attacker's to write.
  let total = 0;
  for (const e of entries) {
    if (e.compressionMethod === 0) {
      // Stored, not deflated -- compressed size IS the decompressed size, nothing to inflate.
      total += e.compressedSize;
      if (total > limits.maxDecompressedBytes) {
        return {
          ok: false,
          entryCount: entries.length,
          inspectedDecompressedBytes: total,
          reason: { kind: "decompressed-size-exceeded", actual: total, limit: limits.maxDecompressedBytes },
        };
      }
      continue;
    }
    const data = localFileData(buf, e);
    if (data === null) {
      return { ok: false, entryCount: entries.length, inspectedDecompressedBytes: total, reason: { kind: "malformed-archive" } };
    }
    const { bytes: produced, aborted } = await inflateWithCap(data, total, limits.maxDecompressedBytes);
    total += produced;
    if (aborted) {
      return {
        ok: false,
        entryCount: entries.length,
        inspectedDecompressedBytes: total,
        reason: { kind: "decompressed-size-exceeded", actual: total, limit: limits.maxDecompressedBytes },
      };
    }
  }

  return { ok: true, entryCount: entries.length, inspectedDecompressedBytes: total, reason: null };
}
