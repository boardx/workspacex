/**
 * F35 -- server-side re-validation of upload limits (uc-22-2 R3 step 1 / R7 / E1).
 *
 * ⚠ **Front-end precheck is UX only.** These are the numbers the SERVER enforces, redone
 * from scratch for every request regardless of what a client already claimed to have
 * checked -- a client that skips its own precheck (or lies about it) must land here.
 *
 * ⚠ **The five numeric caps are `[待确认]` (R10).** Nobody has signed off on the exact
 * megabyte/entry-count values yet. Per the issue's own instruction ("文件大小/批量/解压炸弹
 * 五个上限与类型白名单待确认（R10），不阻塞结构性断言"), that does not block the
 * STRUCTURAL assertion this feature is actually about: a limit exists, is enforced, is
 * reported with actual-vs-limit, and a file over it is rejected before it reaches the real
 * storage area. The numbers below are placeholders sized to be usable in dev/test and are
 * meant to be swapped for real values once R10 is ruled -- swapping them requires touching
 * exactly this one file.
 */

/** Extension (lowercased, with the leading dot) -> the family `mime-sniff.ts` must detect. */
export const EXTENSION_WHITELIST: ReadonlyMap<string, readonly string[]> = new Map([
  [".pdf", ["pdf"]],
  [".doc", ["zip", "unknown"]], // legacy binary OLE format: sniffed as "unknown" here, allowed by extension alone
  [".docx", ["zip"]],
  [".xls", ["zip", "unknown"]],
  [".xlsx", ["zip"]],
  [".ppt", ["zip", "unknown"]],
  [".pptx", ["zip"]],
  [".csv", ["text"]],
  [".txt", ["text"]],
  [".md", ["text"]],
  [".json", ["text"]],
  [".jsonl", ["text"]],
  [".png", ["png"]],
  [".jpg", ["jpeg"]],
  [".jpeg", ["jpeg"]],
  [".gif", ["gif"]],
  [".webp", ["webp"]],
  [".mp3", ["mp3"]],
  [".wav", ["wav"]],
  [".m4a", ["mp4"]],
  [".mp4", ["mp4"]],
  [".mov", ["mp4"]],
  [".zip", ["zip"]],
]);

/** `[待确认]` R10 -- placeholder numbers, see file header. */
export const UPLOAD_LIMITS = {
  /** Single-file cap. */
  maxFileSizeBytes: 200 * 1024 * 1024,
  /** Cap on the sum of sizes in one `uploadArtifact` batch. */
  maxBatchSizeBytes: 1024 * 1024 * 1024,
  /** Cap on total decompressed bytes read out of one archive (zip-bomb limit). */
  maxDecompressedBytes: 500 * 1024 * 1024,
  /** Cap on the number of entries a single archive may declare. */
  maxZipEntries: 2000,
  /** Cap on nested-archive depth (an entry that is itself an archive, recursively). */
  maxZipNestingDepth: 3,
} as const;

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i === -1 ? "" : filename.slice(i).toLowerCase();
}

export type FileLimitViolation =
  | { readonly kind: "FILE_TYPE_REJECTED"; readonly extension: string }
  | { readonly kind: "FILE_TOO_LARGE"; readonly actualBytes: number; readonly limitBytes: number };

/** Server-side redo of the per-file checks (extension whitelist membership + size cap). */
export function validateFileLimits(filename: string, sizeBytes: number): FileLimitViolation | null {
  const ext = extensionOf(filename);
  if (!EXTENSION_WHITELIST.has(ext)) {
    return { kind: "FILE_TYPE_REJECTED", extension: ext };
  }
  if (sizeBytes > UPLOAD_LIMITS.maxFileSizeBytes) {
    return { kind: "FILE_TOO_LARGE", actualBytes: sizeBytes, limitBytes: UPLOAD_LIMITS.maxFileSizeBytes };
  }
  return null;
}

export interface BatchLimitViolation {
  readonly kind: "BATCH_LIMIT_EXCEEDED";
  readonly actualBytes: number;
  readonly limitBytes: number;
}

/** Server-side redo of the batch-total check -- independent of what the client precheck did. */
export function validateBatchLimits(totalBytes: number): BatchLimitViolation | null {
  if (totalBytes > UPLOAD_LIMITS.maxBatchSizeBytes) {
    return { kind: "BATCH_LIMIT_EXCEEDED", actualBytes: totalBytes, limitBytes: UPLOAD_LIMITS.maxBatchSizeBytes };
  }
  return null;
}
