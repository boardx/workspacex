/**
 * The key-to-path mapping `FsObjectStore` uses, extracted so F46's `FsPhysicalPurge` (the
 * "single hole" in `ObjectStore`'s write-once discipline -- see that port's own header) can
 * resolve the SAME path for the SAME key without a second, potentially-drifting copy of the
 * traversal-safety logic. Behavior is unchanged from what `FsObjectStore.pathFor` did
 * inline before this extraction.
 */
import { createHash } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { ObjectStoreUnavailableError } from "../../application/artifact/ports";

export function resolveObjectPath(root: string, key: string): string {
  const safe = key.split("/").filter((p) => p !== "" && p !== "." && p !== "..");
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 12);
  const path = resolve(join(root, ...safe, `_${digest}`));
  const rootResolved = resolve(root);
  if (path !== rootResolved && !path.startsWith(rootResolved + sep)) {
    throw new ObjectStoreUnavailableError("refusing a key that escapes the store root");
  }
  return path;
}
