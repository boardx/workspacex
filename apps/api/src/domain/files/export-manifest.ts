/**
 * F33 -- 批量 zip 导出：目录路径推导 + manifest.json 的形状。
 *
 * Pure. No I/O, no zip format, no object storage -- those live in
 * `infrastructure/files/zip-codec.ts` and `application/files/export-artifacts.ts`.
 *
 * ⚠ `UNSEGMENTED_KEY`/`UNSEGMENTED_LABEL` are imported FROM `artifact-tree.ts`, not redeclared
 * here -- a second declaration site for the same sentinel is exactly the failure shape this
 * repository keeps hitting (design token / 字号档位 / 丢弃原因枚举 / 撤回链 SLA / 估点,
 * five times before this one, per AGENTS.md).
 *
 * ## 目录结构 ≡ 树结构（usecases.md `createExportJob`）
 *
 * `getArtifactTree` 的分组是 (sourceType, agendaSegmentId ?? UNSEGMENTED)。这份契约里的
 * `TreeNode` 是扁平的、没有 parent 指针（见 `artifact-tree.ts` 的说明），所以「目录结构 ≡ 树
 * 结构」在**逐个文件**的粒度上唯一可核对的形式是：每个文件的 zip 内路径的前两段，恰好等于
 * 它在树上落在哪个一级节点 / 二级节点下。`zipEntryPath` 就是这个投影，与
 * `buildArtifactTree` 用的是同一对 key（`UNSEGMENTED_KEY`/`UNSEGMENTED_LABEL`）。
 *
 * ## 文件名是不可信数据（uc-22-2 R7 同源约束）
 *
 * `sanitizeSegment` 拒绝把路径分隔符或纯 `.`/`..` 段落带进 zip 路径 -- 一个标题里带
 * `../../etc/passwd` 的 artifact 不能让导出写到 zip 结构之外（zip slip 的写入侧）。
 */
import { UNSEGMENTED_LABEL } from "./artifact-tree";

/**
 * 导出规模上限。
 *
 * ⚠ `[待定 T-10]`：契约与 usecases.md 都只说「超阈值拒绝，不静默截断」，没有给出数字
 * ——「不阻塞结构性断言」。500 是本实现的占位选择，需要人类裁决后收敛为单一事实源
 * （目前只有这一处声明）。选它是因为：单项目 5000 个 artifact 以内（R9），500 让「必须能
 * 触发拒绝」这件事在测试里可达，同时不至于小到日常批量下载就先撞上限。
 */
export const MAX_EXPORT_ITEMS = 500;

export interface ManifestSourceRow {
  readonly artifactId: string;
  readonly name: string;
  readonly sourceType: string;
  readonly agendaSegmentId: string | null;
  readonly confidential: boolean;
  readonly versionNumber: number;
  readonly sha256: string;
}

/** 一条 `manifest.json` 记录。字段名照抄契约注释里逐字给出的六个键。 */
export interface ManifestEntry {
  readonly artifact_id: string;
  readonly version: number;
  readonly sha256: string;
  readonly source_type: string;
  readonly generated_at: string;
  readonly confidential: boolean;
  /** 该文件在 zip 内的完整路径，供离线核对「manifest 描述的文件真的在这个路径下」。 */
  readonly path: string;
}

export interface Manifest {
  readonly generated_at: string;
  readonly files: readonly ManifestEntry[];
}

const FORBIDDEN_CHARS = new Set(["/", "\\"]);

/**
 * 路径分段清洗。
 *
 * 拒绝空字符串、`.`、`..`，以及任何路径分隔符或 ASCII 控制字符 -- 不是替换成下划线（替换
 * 会让两个不同的原名字悄悄映射到同一路径，manifest 里的名字与 zip 里的名字就对不上了），
 * 而是整体拒绝，调用方必须显式决定怎么处理（这里的处理是退回 artifactId，见 `zipEntryPath`）。
 */
function isSafeSegment(s: string): boolean {
  if (s.length === 0 || s === "." || s === "..") return false;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || FORBIDDEN_CHARS.has(s[i]!)) return false;
  }
  return true;
}

function safeSegment(raw: string, fallback: string): string {
  return isSafeSegment(raw) ? raw : fallback;
}

/**
 * 每个 artifact 在 zip 内的目录路径（不含文件名以外的编号去重，那是调用方的事，见
 * `export-artifacts.ts` 的 `uniqueZipPaths`）。
 *
 * 前两段 = `getArtifactTree` 的两级分组键，第三段 = 文件名。
 */
export function zipEntryPath(row: {
  readonly sourceType: string;
  readonly agendaSegmentId: string | null;
  readonly name: string;
  readonly artifactId: string;
}): readonly [string, string, string] {
  const sourceSeg = safeSegment(row.sourceType, "_source");
  const segmentSeg =
    row.agendaSegmentId === null ? UNSEGMENTED_LABEL : safeSegment(row.agendaSegmentId, UNSEGMENTED_LABEL);
  const fileSeg = safeSegment(row.name, row.artifactId);
  return [sourceSeg, segmentSeg, fileSeg];
}

/**
 * 给定一批行，返回「artifactId -> 最终唯一 zip 路径」。
 *
 * 同一 (sourceType, segment) 下两个文件同名是真实场景（两次上传都叫 `notes.txt`），
 * 静默覆盖会让 manifest 里的条目数与 zip 里的真实文件数不相等 -- 这正是 V4 要求的
 * 「文件数 = manifest 条目数，无静默截断」的另一种触发方式。撞名的加 `artifactId` 后缀消歧。
 */
export function uniqueZipPaths(
  rows: readonly {
    readonly artifactId: string;
    readonly sourceType: string;
    readonly agendaSegmentId: string | null;
    readonly name: string;
  }[],
): ReadonlyMap<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const row of rows) {
    const [a, b, file] = zipEntryPath(row);
    const dir = `${a}/${b}`;
    const key = `${dir}/${file}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const finalFile = n === 1 ? file : `${file}.${row.artifactId}`;
    out.set(row.artifactId, `${dir}/${finalFile}`);
  }
  return out;
}

/** manifest.json 的内容，纯函数：路径已经在 `paths` 里解析好，这里只负责拼装记录。 */
export function buildManifest(
  rows: readonly ManifestSourceRow[],
  paths: ReadonlyMap<string, string>,
  generatedAt: Date,
): Manifest {
  const iso = generatedAt.toISOString();
  return {
    generated_at: iso,
    files: rows.map((r) => ({
      artifact_id: r.artifactId,
      version: r.versionNumber,
      sha256: r.sha256,
      source_type: r.sourceType,
      generated_at: iso,
      confidential: r.confidential,
      path: paths.get(r.artifactId) ?? `${UNSEGMENTED_LABEL}/${r.artifactId}`,
    })),
  };
}
