import { createWriteStream } from "node:fs";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { StorageEngine } from "multer";

const MAX_ACTIVE_UPLOAD_READS = 2;
let activeUploadReads = 0;
let uploadRootPromise: Promise<string> | undefined;

function uploadRoot(): Promise<string> {
  uploadRootPromise ??= mkdtemp(join(tmpdir(), "workspacex-recording-uploads-")).then(async root => {
    await chmod(root, 0o700);
    return root;
  });
  return uploadRootPromise;
}

export class RecordingUploadCapacityError extends Error {
  constructor() { super("recording_upload_capacity_exceeded"); }
}

/**
 * Multer's memoryStorage retains every concurrent 20 MiB recording in the Node heap before
 * the controller can apply authorization or backpressure. This engine spills the bounded
 * request body to a private temporary file and creates it with owner-only permissions.
 */
class RecordingUploadStorage implements StorageEngine {
  _handleFile(_request: Request, file: Express.Multer.File, callback: (error?: unknown, info?: Partial<Express.Multer.File>) => void): void {
    let path: string | undefined;
    void (async () => {
      const root = await uploadRoot();
      path = join(root, randomUUID());
      const output = createWriteStream(path, { flags: "wx", mode: 0o600 });
      await pipeline(file.stream, output);
      callback(undefined, { destination: root, filename: path.slice(root.length + 1), path, size: output.bytesWritten });
    })().catch(async error => {
      if (path) await rm(path, { force: true }).catch(() => undefined);
      callback(error);
    });
  }

  _removeFile(_request: Request, file: Express.Multer.File, callback: (error: Error | null) => void): void {
    if (!file.path) { callback(null); return; }
    void rm(file.path, { force: true }).then(() => callback(null), error => callback(error));
  }
}

export const recordingUploadStorage: StorageEngine = new RecordingUploadStorage();

/** Reads at most the interceptor's fixed file limit and removes the temporary byte copy on every exit. */
export async function withRecordingUpload<T>(file: Express.Multer.File | undefined,
  work: (audio: { buffer: Uint8Array; mimetype: string } | undefined) => Promise<T>): Promise<T> {
  let acquired = false;
  try {
    if (file) {
      if (activeUploadReads >= MAX_ACTIVE_UPLOAD_READS) throw new RecordingUploadCapacityError();
      activeUploadReads += 1;
      acquired = true;
    }
    const audio = file ? { buffer: new Uint8Array(await readFile(file.path)), mimetype: file.mimetype } : undefined;
    return await work(audio);
  } finally {
    if (acquired) activeUploadReads -= 1;
    if (file?.path) await rm(file.path, { force: true });
  }
}
