/**
 * A filesystem-backed `ObjectStore`.
 *
 * ## Why a real store and not an in-memory fake
 *
 * I-5 says every version has a real, downloadable file, and I-3 says the recorded SHA-256 is
 * the SHA-256 of the bytes at that key. An in-memory map satisfies both trivially -- it
 * hands back the exact object it was given, so a round-trip assertion against it tests a
 * `Map`. On disk the bytes are serialised, written, read back and decoded, which is the
 * class of thing that can actually differ.
 *
 * ## What it is and is not a stand-in for
 *
 * It is the deployment-independent implementation: this kernel has no S3 yet, and the
 * compose file deliberately starts only PostgreSQL so the gates stay fast. S3 arrives as a
 * second implementation of the SAME port and nothing above this layer changes.
 *
 * It is NOT a stand-in for I-2. `putOnce` refuses an existing key, which makes THIS writer
 * write-once; the invariant is that the STORE is write-once, and on a filesystem any process
 * with the path can overwrite. On S3 that gap is closed by bucket versioning plus
 * object-lock -- configuration, not code. Stating this here rather than letting the passing
 * `putOnce` test imply the invariant is discharged.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ObjectExistsError, ObjectStoreUnavailableError, type ObjectStore } from "../../application/artifact/ports";
import { resolveObjectPath } from "./object-store-path";

export class FsObjectStore implements ObjectStore {
  /** `mime` is stored beside the object; the filesystem has no metadata slot for it. */
  constructor(private readonly root: string) {}

  async putOnce(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    const path = this.pathFor(key);
    // `wx` = create-and-fail-if-exists, performed by the kernel. A stat-then-write would be
    // a check-then-act race, and the case it loses is two concurrent pins of the same
    // version number -- exactly the concurrency I-10 is about.
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, { flag: "wx" });
      await writeFile(`${path}.mime`, mime, { flag: "wx" });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EEXIST") throw new ObjectExistsError(key);
      // ENOSPC / EACCES / EIO are the store being unavailable, not the request being wrong.
      // The contract distinguishes them (DEPENDENCY_UNAVAILABLE says "retry is safe";
      // MATERIALIZATION_FAILED says "this will not work"), so the adapter has to as well.
      throw new ObjectStoreUnavailableError(`${code ?? "unknown"} writing ${key}`);
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.pathFor(key)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new ObjectStoreUnavailableError(`reading ${key}`);
    }
  }

  async head(key: string): Promise<{ sizeBytes: number; mime: string } | null> {
    try {
      const s = await stat(this.pathFor(key));
      const mime = await readFile(`${this.pathFor(key)}.mime`, "utf8").catch(() => "application/octet-stream");
      return { sizeBytes: s.size, mime };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new ObjectStoreUnavailableError(`heading ${key}`);
    }
  }

  /**
   * Map a storage key to a path under the root. Delegates to `resolveObjectPath` (extracted
   * for F46's `FsPhysicalPurge`, which must resolve the identical path for the identical key
   * -- see that module's header) -- behavior is byte-for-byte what this method did inline
   * before the extraction.
   */
  private pathFor(key: string): string {
    return resolveObjectPath(this.root, key);
  }
}
