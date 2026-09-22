import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportModels, importModels, listModels, splitModelRef } from "../src/model-bundle";

function fakeStore(root: string, ref: string, blobs: Record<string, string>): void {
  const [name, tag] = ref.split(":");
  const dir = join(root, "manifests", "registry.ollama.ai", "library", name!);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(root, "blobs"), { recursive: true });
  const digests = Object.keys(blobs);
  for (const [d, content] of Object.entries(blobs)) writeFileSync(join(root, "blobs", d.replace(":", "-")), content);
  writeFileSync(join(dir, tag!), JSON.stringify({ config: { digest: digests[0] }, layers: digests.slice(1).map((digest) => ({ digest })) }));
}

describe("model bundle", () => {
  it("splits refs and lists models by manifest path", () => {
    expect(splitModelRef("qwen3.5:4b")).toEqual({ name: "qwen3.5", tag: "4b" });
    expect(splitModelRef("llama")).toEqual({ name: "llama", tag: "latest" });
    const s = mkdtempSync(join(tmpdir(), "store-"));
    fakeStore(s, "qwen3.5:4b", { "sha256:c1": "cfg", "sha256:l1": "weights" });
    expect(listModels(s)).toEqual(["qwen3.5:4b"]);
  });

  it("export copies exactly the referenced blobs; import lands them in an empty store and is idempotent", () => {
    const store = mkdtempSync(join(tmpdir(), "store-"));
    fakeStore(store, "qwen3.5:4b", { "sha256:c1": "cfg", "sha256:l1": "weights-4b" });
    fakeStore(store, "other:1b", { "sha256:c2": "cfg2", "sha256:l2": "weights-other" });
    const bundle = mkdtempSync(join(tmpdir(), "bundle-"));
    const r = exportModels(store, bundle, ["qwen3.5:4b"]);
    expect(r).toEqual([{ model: "qwen3.5:4b", blobs: 2, bytes: "cfg".length + "weights-4b".length }]);
    expect(existsSync(join(bundle, "blobs", "sha256-l2"))).toBe(false); // the other model stays out
    const target = mkdtempSync(join(tmpdir(), "target-"));
    expect(importModels(bundle, target)).toEqual({ imported: ["qwen3.5:4b"], skipped: [] });
    expect(readFileSync(join(target, "blobs", "sha256-l1"), "utf8")).toBe("weights-4b");
    expect(listModels(target)).toEqual(["qwen3.5:4b"]);
    expect(importModels(bundle, target)).toEqual({ imported: [], skipped: ["qwen3.5:4b"] });
  });

  it("export refuses a model that is not in the store instead of producing a half bundle", () => {
    const store = mkdtempSync(join(tmpdir(), "store-"));
    const bundle = mkdtempSync(join(tmpdir(), "bundle-"));
    expect(() => exportModels(store, bundle, ["nope:1b"])).toThrow(/ollama pull nope:1b/);
  });
});
