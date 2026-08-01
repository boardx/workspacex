import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { uploadArtifact, type UploadArtifactDeps } from "../../src/application/files/upload-artifact";
import { UPLOAD_LIMITS } from "../../src/domain/files/upload-limits";
import { toOrgId } from "../../src/domain/org-id";
import type { IdFactory, ObjectStore } from "../../src/application/artifact/ports";
import type { QuarantineRepository, SecurityAlertPort } from "../../src/application/files/upload-ports";

/**
 * F35 -- MIME sniffing (V6) and zip-bomb detection (V5), uc-22-2 R3 step 5 ②③.
 *
 * No real database or object store needed for these two: neither check ever reaches
 * `ObjectStore`/`ArtifactRepository` when it rejects, so this file uses in-memory fakes
 * that would throw if a write were attempted -- which doubles as an assertion that neither
 * V5 nor V6 lets a rejected file through to storage.
 */

class ThrowingObjectStore implements ObjectStore {
  putOnce(): Promise<void> {
    throw new Error("must not be called: a rejected file must never reach the real storage area");
  }
  get(): Promise<Uint8Array | null> {
    return Promise.resolve(null);
  }
  head(): Promise<{ sizeBytes: number; mime: string } | null> {
    return Promise.resolve(null);
  }
}

class ThrowingArtifactRepository {
  createArtifact(): Promise<void> {
    throw new Error("must not be called");
  }
  createVersion(): Promise<void> {
    throw new Error("must not be called");
  }
  headVersionNumber(): Promise<number> {
    return Promise.resolve(0);
  }
  findVersion(): Promise<null> {
    return Promise.resolve(null);
  }
  addSegments(): Promise<void> {
    return Promise.resolve();
  }
  findSegments(): Promise<readonly never[]> {
    return Promise.resolve([]);
  }
}

/** A real (in-memory) round-trip store, for the control cases that must actually succeed. */
class MapObjectStore implements ObjectStore {
  private readonly objects = new Map<string, Uint8Array>();
  putOnce(key: string, bytes: Uint8Array): Promise<void> {
    if (this.objects.has(key)) return Promise.reject(new Error(`already exists: ${key}`));
    this.objects.set(key, bytes);
    return Promise.resolve();
  }
  get(key: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }
  head(key: string): Promise<{ sizeBytes: number; mime: string } | null> {
    const b = this.objects.get(key);
    return Promise.resolve(b ? { sizeBytes: b.byteLength, mime: "application/octet-stream" } : null);
  }
}

class NoopQuarantine implements QuarantineRepository {
  async record(): Promise<void> {
    /* not exercised: only MALWARE_DETECTED writes here, not V5/V6 */
  }
}

class NoopAlerts implements SecurityAlertPort {
  async raise(): Promise<void> {
    /* not exercised */
  }
}

function deps(): UploadArtifactDeps {
  let n = 0;
  const ids: IdFactory = { next: (p) => `f35mz-${p}-${++n}` };
  return {
    store: new ThrowingObjectStore(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double, narrower than the port on purpose
    repo: new ThrowingArtifactRepository() as any,
    ids,
    quarantine: new NoopQuarantine(),
    alerts: new NoopAlerts(),
  };
}

const ORG = toOrgId("org-f35-mimezip");
const PROJECT = "proj-f35-mimezip";

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

/** Builds a minimal, valid, single-entry zip. `method` 0 = store, 8 = deflate. */
function buildZip(name: string, data: Buffer, uncompressedSize: number, method: 0 | 8): Buffer {
  const nameBuf = Buffer.from(name, "utf8");
  const localHeader = Buffer.concat([
    u32(0x04034b50),
    u16(20), // version needed
    u16(0), // flags
    u16(method),
    u16(0), // mod time
    u16(0), // mod date
    u32(0), // crc32 -- unchecked by our inspector
    u32(data.length), // compressed size
    u32(uncompressedSize),
    u16(nameBuf.length),
    u16(0), // extra length
    nameBuf,
  ]);
  const localHeaderOffset = 0;
  const entry = Buffer.concat([localHeader, data]);

  const centralHeader = Buffer.concat([
    u32(0x02014b50),
    u16(20), // version made by
    u16(20), // version needed
    u16(0), // flags
    u16(method),
    u16(0),
    u16(0),
    u32(0),
    u32(data.length),
    u32(uncompressedSize),
    u16(nameBuf.length),
    u16(0), // extra
    u16(0), // comment
    u16(0), // disk number
    u16(0), // internal attrs
    u32(0), // external attrs
    u32(localHeaderOffset),
    nameBuf,
  ]);

  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0), // disk number
    u16(0), // disk with cd
    u16(1), // entries on this disk
    u16(1), // total entries
    u32(centralHeader.length), // cd size
    u32(entry.length), // cd offset
    u16(0), // comment length
  ]);

  return Buffer.concat([entry, centralHeader, eocd]);
}

describe("F35 -- MIME sniffing trusts actual bytes only (V6)", () => {
  it("rejects a Windows PE executable renamed to .pdf, and reports the detected type", async () => {
    // 'MZ' DOS/PE magic, padded so it is not mistaken for anything shorter.
    const exe = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(64, 0)]);
    const result = await uploadArtifact(deps(), {
      orgId: ORG,
      projectId: PROJECT,
      agendaSegmentId: null,
      confidential: false,
      actorId: "u-uploader",
      files: [{ filename: "renamed-executable.pdf", bytes: exe }],
    });
    const outcome = result.files[0]!;
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected" && outcome.reason.kind === "MIME_MISMATCH") {
      expect(outcome.reason.detected).toBe("executable-pe");
      expect(outcome.reason.declaredExtension).toBe(".pdf");
    } else {
      throw new Error(`expected MIME_MISMATCH, got ${JSON.stringify(outcome)}`);
    }
  });

  it("rejects an ELF executable renamed to .png", async () => {
    const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(32, 0)]);
    const result = await uploadArtifact(deps(), {
      orgId: ORG,
      projectId: PROJECT,
      agendaSegmentId: null,
      confidential: false,
      actorId: "u-uploader",
      files: [{ filename: "cute-cat.png", bytes: elf }],
    });
    const outcome = result.files[0]!;
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") expect(outcome.reason.kind).toBe("MIME_MISMATCH");
  });

  it("does NOT reject a genuine, correctly-typed file (control case)", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const result = await uploadArtifact(
      { ...deps(), store: new MapObjectStore(), repo: fakeWorkingRepo() },
      {
        orgId: ORG,
        projectId: PROJECT,
        agendaSegmentId: null,
        confidential: false,
        actorId: "u-uploader",
        files: [{ filename: "real.png", bytes: png }],
      },
    );
    expect(result.files[0]!.status).toBe("accepted");
  });
});

describe("F35 -- zip-bomb limits without full decompression (V5)", () => {
  it("rejects a high-compression-ratio zip whose decompressed size exceeds the cap, reporting actual vs limit", async () => {
    const overCap = UPLOAD_LIMITS.maxDecompressedBytes + (10 * 1024 * 1024);
    const uncompressed = Buffer.alloc(overCap, 0); // all-zero: compresses to almost nothing
    const compressed = deflateRawSync(uncompressed);
    // Sanity: the whole point of this fixture is a hostile compression ratio.
    expect(compressed.length).toBeLessThan(overCap / 100);

    // The Central Directory's own `uncompressed size` field is DECLARED here as a lie
    // (a plausible-looking small number) -- this is what a real attacker controls, and
    // exactly what the header comment in `zip-inspect.ts` says is not trusted. If this
    // fixture instead declared the true size, the fast declared-size pre-check alone would
    // catch it (a legitimate, even stronger rejection: zero bytes inflated) and this test
    // would never actually exercise the streaming abort this feature's safety property
    // depends on. Lying forces the code path through real, bounded-memory decompression.
    const zip = buildZip("payload.bin", compressed, 1024, 8);

    const result = await uploadArtifact(deps(), {
      orgId: ORG,
      projectId: PROJECT,
      agendaSegmentId: null,
      confidential: false,
      actorId: "u-uploader",
      files: [{ filename: "innocuous.zip", bytes: zip }],
    });

    const outcome = result.files[0]!;
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected" && outcome.reason.kind === "ARCHIVE_BOMB_DETECTED") {
      expect(outcome.reason.reason.kind).toBe("decompressed-size-exceeded");
      if (outcome.reason.reason.kind === "decompressed-size-exceeded") {
        expect(outcome.reason.reason.limit).toBe(UPLOAD_LIMITS.maxDecompressedBytes);
        // "actual" is what was OBSERVED before the stream was torn down -- never the full
        // `overCap`, because inflation is aborted the instant the cap is crossed.
        expect(outcome.reason.reason.actual).toBeGreaterThan(UPLOAD_LIMITS.maxDecompressedBytes);
        expect(outcome.reason.reason.actual).toBeLessThan(overCap);
      }
    } else {
      throw new Error(`expected ARCHIVE_BOMB_DETECTED, got ${JSON.stringify(outcome)}`);
    }
  });

  it("rejects immediately (zero bytes inflated) when the Central Directory HONESTLY declares an over-cap size", async () => {
    const overCap = UPLOAD_LIMITS.maxDecompressedBytes + (10 * 1024 * 1024);
    const uncompressed = Buffer.alloc(overCap, 0);
    const compressed = deflateRawSync(uncompressed);
    const zip = buildZip("payload.bin", compressed, overCap, 8); // truthful declared size this time

    const result = await uploadArtifact(deps(), {
      orgId: ORG,
      projectId: PROJECT,
      agendaSegmentId: null,
      confidential: false,
      actorId: "u-uploader",
      files: [{ filename: "honest-but-still-a-bomb.zip", bytes: zip }],
    });

    const outcome = result.files[0]!;
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected" && outcome.reason.kind === "ARCHIVE_BOMB_DETECTED") {
      expect(outcome.reason.reason.kind).toBe("decompressed-size-exceeded");
    } else {
      throw new Error(`expected ARCHIVE_BOMB_DETECTED, got ${JSON.stringify(outcome)}`);
    }
  });

  it("accepts a well-behaved small zip (control case)", async () => {
    const small = Buffer.from("hello world, this is a perfectly normal small file");
    const compressed = deflateRawSync(small);
    const zip = buildZip("hello.txt", compressed, small.length, 8);

    const result = await uploadArtifact(
      { ...deps(), store: new MapObjectStore(), repo: fakeWorkingRepo() },
      {
        orgId: ORG,
        projectId: PROJECT,
        agendaSegmentId: null,
        confidential: false,
        actorId: "u-uploader",
        files: [{ filename: "normal.zip", bytes: zip }],
      },
    );
    expect(result.files[0]!.status).toBe("accepted");
  });
});

/** A repository double that behaves like a fresh, empty artifact store -- for control cases. */
function fakeWorkingRepo() {
  return {
    createArtifact: () => Promise.resolve(),
    createVersion: () => Promise.resolve(),
    headVersionNumber: () => Promise.resolve(0),
    findVersion: () => Promise.resolve(null),
    addSegments: () => Promise.resolve(),
    findSegments: () => Promise.resolve([]),
    findVersionByIdempotencyKey: () => Promise.resolve(null),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
