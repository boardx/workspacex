/**
 * F46's `PhysicalPurgePort` over the filesystem-backed store (`FsObjectStore`'s deployment
 * pair, same root). See `application/files/physical-delete-ports.ts`'s own header for why
 * this is a SEPARATE port/class rather than a `delete` method added to `ObjectStore` --
 * `ObjectStore`'s header calls this out by name as "the single hole" X-4 opens, and this
 * class IS that hole, kept out of the port every other write-once caller depends on.
 *
 * ⚠ What this does NOT discharge: R7/E5's "对象存储若开启版本化，物理删除必须删除所有历史
 * 版本与删除标记" (every historical version + delete marker in a versioned bucket) is a
 * property of an S3-style bucket that `FsObjectStore` never claimed to emulate in the first
 * place (`putOnce` refusing an existing key ≠ the store itself is versioned -- see that
 * class's own header). A filesystem `unlink` deletes the one file at the resolved path,
 * which is everything a non-versioned deployment (this kernel's phase-01 default) has to
 * delete. The S3 implementation of this SAME port is where "loop over every version +
 * write/clear the delete marker" actually has to happen, and nothing above this layer
 * changes when that implementation arrives -- same relationship `FsObjectStore`'s header
 * describes for `putOnce`/`get`/`head`.
 */
import { unlink } from "node:fs/promises";
import type { PhysicalPurgePort } from "../../application/files/physical-delete-ports";
import { resolveObjectPath } from "./object-store-path";

export class FsPhysicalPurge implements PhysicalPurgePort {
  constructor(private readonly root: string) {}

  async purgeAll(
    keys: readonly string[],
  ): Promise<readonly { readonly objectKey: string; readonly deleted: boolean }[]> {
    const outcomes: { objectKey: string; deleted: boolean }[] = [];
    for (const key of keys) {
      try {
        const path = resolveObjectPath(this.root, key);
        await unlink(path);
        // The `.mime` companion file `FsObjectStore.putOnce` writes alongside the bytes.
        // Best-effort: its absence must not fail a purge whose bytes are already gone.
        await unlink(`${path}.mime`).catch(() => undefined);
        outcomes.push({ objectKey: key, deleted: true });
      } catch (e) {
        // ENOENT counts as deleted -- there is nothing left at that key either way, which
        // is the property N-19's disclosure cares about, not "did THIS call do the work".
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          outcomes.push({ objectKey: key, deleted: true });
        } else {
          outcomes.push({ objectKey: key, deleted: false });
        }
      }
    }
    return outcomes;
  }
}
