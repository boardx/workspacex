/**
 * `DirectoryBackedAssetRuntimeLoader` -- the phase-1 implementation of `AssetRuntimeLoaderPort`
 * (F143, domain I-6).
 *
 * Delegates straight to the SAME `AssetFileRepository.getDirectory` that `GetAssetDirectory`
 * calls. This is not a placeholder shortcut -- it is what `uc-23-3` R7 rule 1 ("目录结构就是
 * 发布出去的结构") actually demands: an implementation with no separate packaging/materialized
 * artifact step, so the loaded set and the directory listing are structurally the same read
 * and cannot drift apart. See `application/asset/ports.ts`'s header on this port for why a
 * future real runtime must preserve this property, not just this stand-in.
 */
import type { AssetFileRepository, AssetKind, AssetRuntimeLoaderPort } from "../../application/asset/ports";
import type { OrgId } from "../../domain/org-id";

export class DirectoryBackedAssetRuntimeLoader implements AssetRuntimeLoaderPort {
  constructor(private readonly assets: AssetFileRepository) {}

  async loadedFilePaths(orgId: OrgId, assetKind: AssetKind, assetId: string): Promise<readonly string[] | null> {
    const directory = await this.assets.getDirectory(orgId, assetKind, assetId);
    if (directory === null) return null;
    return directory.entries.map((e) => e.path);
  }
}
