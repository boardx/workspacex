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
 * already there (same digest = same bytes). Ollama reads the manifests directory on every
 * list/pull, so an imported model is visible without a restart.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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

/**
 * Copy the bundle's models into `store` (the directory the running Ollama serves from).
 * Returns what was actually imported; models whose manifest already exists are left alone.
 */
export function importModels(bundle: string, store: string): { imported: string[]; skipped: string[] } {
  const imported: string[] = [];
  const skipped: string[] = [];
  for (const ref of listModels(bundle)) {
    const { name, tag } = splitModelRef(ref);
    const manifestDst = join(store, MANIFESTS, name, tag);
    if (existsSync(manifestDst)) { skipped.push(ref); continue; }
    const manifestSrc = join(bundle, MANIFESTS, name, tag);
    const m = readManifest(manifestSrc);
    // blobs first, manifest last: a manifest without its blobs would make Ollama report a
    // broken model; a blob without a manifest is just unused space.
    for (const d of digestsOf(m)) {
      const src = join(bundle, "blobs", blobFile(d));
      if (!existsSync(src)) throw new Error(`bundle is missing blob ${d} for ${ref}`);
      copyIfMissing(src, join(store, "blobs", blobFile(d)));
    }
    copyIfMissing(manifestSrc, manifestDst);
    imported.push(ref);
  }
  return { imported, skipped };
}
