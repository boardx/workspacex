/**
 * `buildAssetDirectory` —— F141（`uc-23-3` R3 步骤 2/3，验收线索 R12-1/2/3/4）。
 *
 * 把一份「扁平文件清单」（路径 + 大小）投影成契约 `getAssetDirectory.out` 的两个视图：
 *   `tree`  —— 目录 + 文件两级节点，**用 `path` 表达层级，不做嵌套 `children`**
 *              （见 `asset-governance.ts` 对 `AssetTreeNode` 的注：嵌套的 out 无法逐层
 *              `.strict()`，这是契约层已经定的形状，本函数只是消费它）。
 *   `files` —— 只含文件（不含目录），带 `badge` / `isRoot`。
 *
 * 纯函数，不做任何 IO 或权限判断——那些是 application 层的事。
 *
 * ⚠ **目录节点的出现顺序 = 深度优先、遇到即登记**，不做字母排序：
 *   `uc-23-3` R12-1/2 的验收线索是「文件树逐字等于 SK_TREE / AG_TREE」，
 *   而原型给的两棵树都是「先列所在目录，再列该目录下的文件」这个顺序；改成字母排序
 *   会让顺序与原型对不上，而顺序本身就是这条验收线索要断言的东西之一。
 */
import { assetFileBadgeFromPath } from "@repo/contracts/asset-governance";

export interface AssetFileEntry {
  readonly path: string;
  readonly sizeBytes: number;
}

export interface AssetTreeNodeOut {
  readonly path: string;
  readonly kind: "dir" | "file";
  readonly depth: number;
}

export interface AssetFileOut {
  readonly path: string;
  readonly sizeBytes: number;
  readonly badge: ReturnType<typeof assetFileBadgeFromPath>;
  readonly isRoot: boolean;
}

export interface AssetDirectoryOut {
  readonly rootFile: string;
  readonly tree: readonly AssetTreeNodeOut[];
  readonly files: readonly AssetFileOut[];
}

export function buildAssetDirectory(rootFile: string, entries: readonly AssetFileEntry[]): AssetDirectoryOut {
  const tree: AssetTreeNodeOut[] = [];
  const files: AssetFileOut[] = [];
  const seenDirs = new Set<string>();

  for (const entry of entries) {
    const parts = entry.path.split("/");
    // Directory ancestors, shallowest first -- so a nested dir's parent is always emitted
    // before it, matching how a real file explorer expands a tree top-down.
    for (let depth = 0; depth < parts.length - 1; depth += 1) {
      const dirPath = parts.slice(0, depth + 1).join("/");
      if (seenDirs.has(dirPath)) continue;
      seenDirs.add(dirPath);
      tree.push({ path: dirPath, kind: "dir", depth });
    }
    const fileDepth = parts.length - 1;
    tree.push({ path: entry.path, kind: "file", depth: fileDepth });
    files.push({
      path: entry.path,
      sizeBytes: entry.sizeBytes,
      badge: assetFileBadgeFromPath(entry.path),
      isRoot: entry.path === rootFile,
    });
  }

  return { rootFile, tree, files };
}
