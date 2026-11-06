import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DurableImageModelProvider } from "../../src/infrastructure/agent-run/durable-image-model-provider";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import type { ModelCallInput } from "../../src/application/agent-run/ports";
import { Transformer } from "@napi-rs/image";
import type { BailianImageProvider } from "../../src/infrastructure/agent-run/bailian-image-provider";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const folders: string[] = [];
afterEach(async () => { for (const root of folders.splice(0)) await rm(root, { recursive: true, force: true }); });
const input = { orgId: "org-image-6319", runId: "run-image-6319", executionAttemptId: "attempt", executionLeaseEpoch: 1,
  user: "蓝色图标", system: "", modelProvider: "bailian-image", modelId: "wanx2.1-t2i-plus" } as ModelCallInput;

async function setup(bytes = png) {
  const root = await mkdtemp(join(tmpdir(), "wx-image-model-")); folders.push(root);
  const objects = new FsObjectStore(root);
  const provider = { supportsRequestAccounting: () => true, generateImage: vi.fn<BailianImageProvider["generateImage"]>(async () => ({
    delivery: "url" as const, url: "https://provider.invalid/temporary.png", taskId: "task", modelRef: input.modelId,
  })) };
  const downloader = { download: vi.fn(async () => ({ bytes, mime: "image/png" as const })) };
  return { objects, provider, downloader, model: new DurableImageModelProvider(provider, objects, downloader) };
}

it("archives decodable bytes and returns a durable message attachment, never a temporary URL", async () => {
  const f = await setup(); const result = await f.model.complete(input);
  expect(result.text).not.toContain("https://"); expect(result.files).toHaveLength(1);
  const file = result.files![0]!;
  expect(file).toMatchObject({ name: "generated-image.png", mime: "image/png", sizeBytes: png.length });
  const restored = await f.objects.get(file.objectKey);
  expect(Buffer.from(restored!)).toEqual(png);
  expect(new Transformer(Buffer.from(restored!)).rawPixelsSync().length).toBeGreaterThan(0);
  expect(f.provider.generateImage).toHaveBeenCalledTimes(1);
  expect(f.provider.generateImage.mock.calls[0]![2]).toMatchObject({ orgId: input.orgId, parentRunId: input.runId });
});

it("fails closed on download, corrupt pixels or storage readback failure without a second generation", async () => {
  const f = await setup(); f.downloader.download.mockRejectedValueOnce(new Error("private supplier URL"));
  await expect(f.model.complete(input)).rejects.toMatchObject({ detail: "generated_image_unavailable" });
  const invalid = await setup(Buffer.from("not an image"));
  await expect(invalid.model.complete(input)).rejects.toMatchObject({ detail: "generated_image_unavailable" });
  const corruptBytes = Buffer.from(png); corruptBytes[45] = corruptBytes[45]! ^ 1;
  const corrupt = await setup(corruptBytes);
  await expect(corrupt.model.complete(input)).rejects.toMatchObject({ detail: "generated_image_unavailable" });
  const lost = await setup(); vi.spyOn(lost.objects, "get").mockResolvedValue(null);
  await expect(lost.model.complete(input)).rejects.toMatchObject({ detail: "generated_image_unavailable" });
  for (const fixture of [f, invalid, corrupt, lost]) expect(fixture.provider.generateImage).toHaveBeenCalledTimes(1);
});

it("rejects absent ownership and cancellation before billable generation", async () => {
  const f = await setup();
  await expect(f.model.complete({ ...input, orgId: undefined })).rejects.toThrow();
  await expect(f.model.complete({ ...input, signal: AbortSignal.abort() })).rejects.toThrow();
  expect(f.provider.generateImage).not.toHaveBeenCalled();
});
