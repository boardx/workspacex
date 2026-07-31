/**
 * `ObjectStoreProbe` over the real `ObjectStore` (F31, V7·22-1).
 *
 * The list endpoint must return **200 with metadata** while object storage is down, and only
 * degrade download and preview. So the browser needs to know reachability without a byte
 * transfer -- which is what `head()` is for.
 *
 * ## Why a key that does not exist is the right probe
 *
 * `head()` on a missing key returns `null`; on an unreachable store it throws. Those two are
 * exactly the distinction the endpoint needs, and using a REAL key would be worse: it would
 * report "unavailable" whenever that particular object had been deleted, and the browser would
 * grey out downloads for the entire project because of one missing file.
 */
import type { ObjectStore } from "../../application/artifact/ports";
import type { ObjectStoreProbe } from "../../application/files/ports";

/** Reserved, never written -- `putOnce` refuses overwrites, so nothing can claim it. */
const PROBE_KEY = "_kernel/probe/object-store-reachable";

export class ObjectStoreHeadProbe implements ObjectStoreProbe {
  constructor(private readonly store: ObjectStore) {}

  async available(): Promise<boolean> {
    try {
      await this.store.head(PROBE_KEY);
      return true;
    } catch {
      // Deliberately swallowed rather than logged-and-rethrown: this answer is a FIELD in a
      // 200 response, not an error path. Throwing here would turn "downloads are degraded"
      // into "the file list is broken", which is the failure V7 exists to prevent.
      return false;
    }
  }
}
