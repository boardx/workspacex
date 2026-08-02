/**
 * `computeRuntimeLoadSetDiff` -- domain I-6 (`uc-23-3` R7 rule 1 / R12-11), pure comparison.
 *
 * 🔴 **Bidirectional, on purpose.** A single-direction check ("every loaded file is in the
 * directory listing", i.e. `loaded ⊆ directory`) is still green on an implementation whose
 * listing shows a few MORE files than runtime actually reloads -- exactly the bug this
 * invariant exists to catch: a file edited in the editor that runtime silently keeps serving
 * a stale (or absent) copy of. The other direction alone (`directory ⊆ loaded`) is equally
 * blind to the opposite bug: runtime quietly reading a file that never shows up in the
 * directory listing at all. Only asserting BOTH subset directions -- i.e. set equality --
 * catches either kind of drift.
 *
 * Pure function, no IO: callers assemble `directoryPaths` from `AssetFileRepository`
 * .getDirectory() and `runtimePaths` from `AssetRuntimeLoaderPort.loadedFilePaths()`, then
 * hand both flat path lists here.
 */

export interface RuntimeLoadSetDiff {
  readonly equal: boolean;
  /** In the directory listing but never loaded at runtime -- the "stale editor" bug. */
  readonly onlyInDirectory: readonly string[];
  /** Loaded at runtime but absent from the directory listing -- the "secret read" bug. */
  readonly onlyInRuntime: readonly string[];
}

export function computeRuntimeLoadSetDiff(
  directoryPaths: readonly string[],
  runtimePaths: readonly string[],
): RuntimeLoadSetDiff {
  const directorySet = new Set(directoryPaths);
  const runtimeSet = new Set(runtimePaths);

  const onlyInDirectory = directoryPaths.filter((p) => !runtimeSet.has(p));
  const onlyInRuntime = runtimePaths.filter((p) => !directorySet.has(p));

  return {
    equal: onlyInDirectory.length === 0 && onlyInRuntime.length === 0,
    onlyInDirectory,
    onlyInRuntime,
  };
}
