import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { RecordingUploadCapacityError, withRecordingUpload } from "../../src/interface/recording/recording-upload-storage";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(async root => {
  const path = join(root, "audio");
  await stat(path).then(() => { throw new Error(`temporary upload leaked: ${path}`); }, () => undefined);
  await rm(root, { recursive: true, force: true });
})); });

async function storedFile(): Promise<Express.Multer.File> {
  const dir = await mkdtemp(join(tmpdir(), "recording-upload-test-"));
  const path = join(dir, "audio"); roots.push(dir);
  await writeFile(path, Buffer.from("bounded-audio"));
  return { path, mimetype: "audio/webm" } as Express.Multer.File;
}

it("reads the disk-backed upload and removes it after success", async () => {
  const file = await storedFile();
  await expect(withRecordingUpload(file, async audio => Buffer.from(audio!.buffer).toString("utf8"))).resolves.toBe("bounded-audio");
  await expect(readFile(file.path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("removes the disk-backed upload when validation or materialization fails", async () => {
  const file = await storedFile();
  await expect(withRecordingUpload(file, async () => { throw new Error("rejected"); })).rejects.toThrow("rejected");
  await expect(readFile(file.path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("bounds simultaneous heap reads and removes the rejected temporary upload", async () => {
  const files = await Promise.all([storedFile(), storedFile(), storedFile()]);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const first = withRecordingUpload(files[0], async () => blocked);
  const second = withRecordingUpload(files[1], async () => blocked);
  await expect(withRecordingUpload(files[2], async () => undefined)).rejects.toBeInstanceOf(RecordingUploadCapacityError);
  await expect(readFile(files[2].path)).rejects.toMatchObject({ code: "ENOENT" });
  release();
  await Promise.all([first, second]);
});
