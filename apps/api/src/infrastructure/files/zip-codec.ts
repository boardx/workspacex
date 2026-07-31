/**
 * F33 -- a minimal, standards-shaped ZIP writer/reader.
 *
 * ## Why hand-rolled rather than a dependency
 *
 * `apps/api/package.json` has no zip library today, and the round-trip property this feature
 * needs (「zip 内部目录结构 ≡ 树结构」+ manifest sha256 equality) does not need compression --
 * it needs a byte-exact, standard ZIP container. STORE (method 0) is the entire compression
 * strategy here: no `deflate`, so no dependency on a streaming compressor and no risk of this
 * file quietly producing a stream a real unzip tool cannot open because a level was wrong.
 *
 * The two functions below are inverses of EXACTLY each other's format (local file header +
 * central directory + end-of-central-directory), which is what "real zip" means: any tool that
 * reads the APPNOTE.TXT layout (Explorer, Archive Utility, `unzip`, Python's `zipfile`) can open
 * what `writeZip` produces, and `readZip` can open what any of them produce, PROVIDED the
 * entries are stored (uncompressed) -- deflate-compressed input is out of scope for `readZip`
 * and is not needed by anything in this bundle.
 *
 * ## UTF-8 names, always
 *
 * The general-purpose bit flag's bit 11 ("language encoding flag") is set on every entry, and
 * every name is written as UTF-8. Directory names in this feature are 来源类型 / agenda_segment
 * labels -- routinely CJK (`未归入环节`) -- and a zip that only round-trips ASCII names would
 * silently mojibake every export from a Chinese-language project, which is the majority case
 * here, not an edge case.
 */
import { crc32 } from "node:zlib";
import type { ZipBuilder, ZipEntry } from "../../application/files/export-ports";

export interface ZipEntryIn {
  readonly path: string;
  readonly content: Uint8Array;
}

export interface ZipEntryOut {
  readonly path: string;
  readonly content: Uint8Array;
}

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** Bit 11: filenames and comments are UTF-8, not the legacy IBM437/CP437 default. */
const UTF8_FLAG = 0x0800;
/** Method 0: stored, no compression -- see the header for why. */
const METHOD_STORE = 0;

function dosDateTime(d: Date): { time: number; date: number } {
  // ZIP's own timestamp format (APPNOTE 4.4.6), 2-second resolution. Not load-bearing for any
  // assertion this feature makes; present because a zip entry with a zeroed date reads as
  // 1980-01-01 in every GUI tool and looks like a bug to whoever opens the export.
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function crc32Of(buf: Uint8Array): number {
  return crc32(buf) >>> 0;
}

/**
 * Build a ZIP archive from entries, STORE method, UTF-8 names.
 *
 * Paths use `/` (the ZIP standard, independent of the writing OS) and must not start with `/`
 * or contain `..` segments -- callers are expected to have gone through
 * `domain/files/export-manifest.ts`'s path builder, which already refuses those; this function
 * asserts it again so a bug upstream cannot silently produce a zip that escapes its own root.
 */
export function writeZip(entries: readonly ZipEntryIn[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());

  for (const entry of entries) {
    if (entry.path.startsWith("/") || entry.path.split("/").includes("..")) {
      throw new Error(`unsafe zip path: ${entry.path}`);
    }
    const nameBytes = Buffer.from(entry.path, "utf8");
    const crc = crc32Of(entry.content);
    const size = entry.content.byteLength;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_FILE_HEADER_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(METHOD_STORE, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    chunks.push(local, nameBytes, entry.content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_DIR_SIG, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(METHOD_STORE, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset

    centralChunks.push(central, nameBytes);
    offset += local.length + nameBytes.length + size;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of centralChunks) centralSize += c.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...chunks, ...centralChunks, eocd]);
}

/**
 * Read a STORE-method ZIP back into entries.
 *
 * Walks the central directory (authoritative for entry count and names, per APPNOTE) rather
 * than scanning for local headers -- the same reason real unzip implementations do it this
 * way: the central directory is the single index a truncated/corrupt local stream cannot fool.
 */
export function readZip(buf: Uint8Array): ZipEntryOut[] {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);

  // Find EOCD by scanning from the end -- there is no zip comment in anything this function
  // writes or is asked to read, so the fixed-size record sits at buf.length - 22.
  let eocdOffset = -1;
  for (let i = b.length - 22; i >= 0; i--) {
    if (b.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("not a zip: no end-of-central-directory record");

  const entryCount = b.readUInt16LE(eocdOffset + 10);
  const centralStart = b.readUInt32LE(eocdOffset + 16);

  const out: ZipEntryOut[] = [];
  let p = centralStart;
  for (let i = 0; i < entryCount; i++) {
    if (b.readUInt32LE(p) !== CENTRAL_DIR_SIG) throw new Error(`corrupt central directory at entry ${i}`);
    const method = b.readUInt16LE(p + 10);
    const compSize = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const localOffset = b.readUInt32LE(p + 42);
    const name = b.toString("utf8", p + 46, p + 46 + nameLen);

    if (method !== METHOD_STORE) {
      throw new Error(`entry "${name}" uses compression method ${method}, only STORE (0) is supported`);
    }

    // Local header name/extra lengths can differ in principle from the central copy; read
    // them from the local header itself rather than assuming they match.
    const localNameLen = b.readUInt16LE(localOffset + 26);
    const localExtraLen = b.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const content = new Uint8Array(b.subarray(dataStart, dataStart + compSize));

    out.push({ path: name, content });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** The application layer's `ZipBuilder` port, implemented with this file's writer. */
export class NodeZipBuilder implements ZipBuilder {
  build(entries: readonly ZipEntry[]): Uint8Array {
    return writeZip(entries);
  }
}
