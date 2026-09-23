/**
 * Ship Ollama models inside the desktop bundle (issue #3716, human decision 2026-09-17: the
 * model goes into the DMG, no first-start download).
 *
 * An Ollama model store is a portable file tree:
 *   <store>/manifests/registry.ollama.ai/library/<name>/<tag>   JSON manifest
 *   <store>/blobs/sha256-<hex>                                 config + layers it references
 * `exportModels` copies exactly the manifests + blobs of the requested models out of a store
 * (the build machine's ~/.ollama/models) into the bundle dir; `importModels` copies whatever
 * the bundle holds into the store the Ollama we talk to actually uses, skipping blobs that are
 * already there. Ollama reads the manifests directory on every list/pull, so an imported model
 * is visible without a restart.
 *
 * ⚠ 这段头注原来写着跳过的判据是「same digest = same bytes」，而代码里只比了文件大小。
 *   真正按摘要校验、带确定性进度、可被中断而不留残片的拷贝在 `model-import.ts` 里，
 *   `importModels` 现在走那条路（#3872 维度 2）。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { copyBlobVerified, etaSeconds, type ImportProgress } from "./model-import";

interface Manifest {
  readonly config: { readonly digest: string; readonly size?: number };
  readonly layers: readonly { readonly digest: string; readonly size?: number }[];
}

const MANIFESTS = join("manifests", "registry.ollama.ai", "library");

function blobFile(digest: string): string {
  return digest.replace(":", "-"); // sha256:abc -> sha256-abc
}

/** "qwen3.5:4b" -> ["qwen3.5", "4b"]; a bare name means tag "latest". */
export function splitModelRef(ref: string): { name: string; tag: string } {
  const i = ref.lastIndexOf(":");
  return i < 0 ? { name: ref, tag: "latest" } : { name: ref.slice(0, i), tag: ref.slice(i + 1) };
}

function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

function digestsOf(m: Manifest): string[] {
  return [m.config.digest, ...m.layers.map((l) => l.digest)];
}

function copyIfMissing(src: string, dst: string): boolean {
  if (existsSync(dst) && statSync(dst).size === statSync(src).size) return false;
  mkdirSync(join(dst, ".."), { recursive: true });
  copyFileSync(src, dst);
  return true;
}

/** Copy the given models (manifest + every blob they reference) from `store` into `dest`. */
export function exportModels(store: string, dest: string, models: readonly string[]): { model: string; blobs: number; bytes: number }[] {
  const out: { model: string; blobs: number; bytes: number }[] = [];
  for (const ref of models) {
    const { name, tag } = splitModelRef(ref);
    const manifestSrc = join(store, MANIFESTS, name, tag);
    if (!existsSync(manifestSrc)) throw new Error(`model ${ref} not in store ${store} (run: ollama pull ${ref})`);
    const m = readManifest(manifestSrc);
    let bytes = 0;
    for (const d of digestsOf(m)) {
      const src = join(store, "blobs", blobFile(d));
      if (!existsSync(src)) throw new Error(`blob ${d} of ${ref} missing in ${store}`);
      copyIfMissing(src, join(dest, "blobs", blobFile(d)));
      bytes += statSync(src).size;
    }
    copyIfMissing(manifestSrc, join(dest, MANIFESTS, name, tag));
    out.push({ model: ref, blobs: digestsOf(m).length, bytes });
  }
  return out;
}

/** Every model ref present in a store/bundle, e.g. ["qwen3.5:4b"]. */
export function listModels(store: string): string[] {
  const root = join(store, MANIFESTS);
  if (!existsSync(root)) return [];
  const refs: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else refs.push(relative(root, p).replace(/\/([^/]+)$/, ":$1"));
    }
  };
  walk(root);
  return refs.sort();
}

/** 一次导入要搬什么——**先数清楚**，百分比才是确定性的而不是转圈。 */
export interface ImportPlan {
  readonly items: readonly { readonly ref: string; readonly digest: string; readonly src: string; readonly dst: string; readonly size: number }[];
  readonly models: readonly string[];
  readonly skipped: readonly string[];
  readonly bytesTotal: number;
}

export function planImport(bundle: string, store: string): ImportPlan {
  const items: { ref: string; digest: string; src: string; dst: string; size: number }[] = [];
  const models: string[] = [];
  const skipped: string[] = [];
  for (const ref of listModels(bundle)) {
    const { name, tag } = splitModelRef(ref);
    if (existsSync(join(store, MANIFESTS, name, tag))) { skipped.push(ref); continue; }
    models.push(ref);
    for (const d of digestsOf(readManifest(join(bundle, MANIFESTS, name, tag)))) {
      const src = join(bundle, "blobs", blobFile(d));
      if (!existsSync(src)) throw new Error(`bundle is missing blob ${d} for ${ref}`);
      items.push({ ref, digest: d, src, dst: join(store, "blobs", blobFile(d)), size: statSync(src).size });
    }
  }
  return { items, models, skipped, bytesTotal: items.reduce((a, b) => a + b.size, 0) };
}

/**
 * Copy the bundle's models into `store` (the directory the running Ollama serves from).
 * Returns what was actually imported; models whose manifest already exists are left alone.
 *
 * 进度按**字节**报，不按文件个数：一个模型的 blob 大小差着三四个数量级，
 * 按个数报会出现「3/4 已完成」然后卡住两分钟——那正是 7 分档「进度条但是转圈」的观感。
 */
export async function importModels(
  bundle: string,
  store: string,
  opts: { readonly onProgress?: (p: ImportProgress) => void; readonly now?: () => number } = {},
): Promise<{ imported: string[]; skipped: string[] }> {
  const plan = planImport(bundle, store);
  const now = opts.now ?? (() => Date.now());
  const startedAt = now();
  let bytesDone = 0;
  let blobsDone = 0;
  let lastEmit = 0;
  const emit = (ref: string, force: boolean): void => {
    if (opts.onProgress === undefined) return;
    const t = now();
    if (!force && t - lastEmit < 200) return;     // 每秒五次足够，再密只是烧 CPU
    lastEmit = t;
    opts.onProgress({
      model: ref,
      bytesDone, bytesTotal: plan.bytesTotal,
      blobsDone, blobsTotal: plan.items.length,
      etaSeconds: etaSeconds(bytesDone, plan.bytesTotal, t - startedAt),
    });
  };

  const imported: string[] = [];
  for (const ref of plan.models) {
    // blobs first, manifest last: a manifest without its blobs would make Ollama report a
    // broken model; a blob without a manifest is just unused space.
    for (const it of plan.items.filter((x) => x.ref === ref)) {
      emit(ref, false);
      await copyBlobVerified(it.src, it.dst, { onBytes: (d) => { bytesDone += d; emit(ref, false); } });
      blobsDone += 1;
      emit(ref, true);
    }
    const { name, tag } = splitModelRef(ref);
    copyIfMissing(join(bundle, MANIFESTS, name, tag), join(store, MANIFESTS, name, tag));
    imported.push(ref);
  }
  return { imported, skipped: [...plan.skipped] };
}
