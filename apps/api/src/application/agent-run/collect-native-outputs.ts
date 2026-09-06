import { createHash } from "node:crypto";
import { sandboxSession as S, standardCapabilities as SC } from "@repo/contracts";
import { ObjectExistsError, type ObjectStore } from "../artifact/ports";
import type { RunOutputFile } from "./ports";
import { outputFileMime } from "./output-file-mime";

/** Factory-bound session/token. Implementations reject directories and failed downloads. */
export interface BoundSessionFiles { read(path: string): Promise<unknown> }
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** No attachment/event writes. A failed batch may leave unreferenced immutable objects. */
export async function collectNativeOutputs(
  deps: { sessionFiles: BoundSessionFiles; objects: ObjectStore },
  input: { runId: string; paths: readonly string[] },
): Promise<readonly RunOutputFile[]> {
  if (!input.runId.trim() || input.runId.length > 256 || input.paths.length > S.limits.maxFiles) throw new Error("native_output_limit");
  const names = new Set<string>();
  for (const path of input.paths) {
    if (!path.startsWith("/workspace/")) throw new Error("native_output_path");
    SC.SkillPackagePath.parse(path.slice("/workspace/".length));
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (names.has(name)) throw new Error("native_output_duplicate_name");
    names.add(name);
  }
  let total = 0;
  const files: RunOutputFile[] = [];
  for (const path of input.paths) {
    const file = S.schemas.file.parse(await deps.sessionFiles.read(path));
    if (file.path !== path) throw new Error("native_output_path_mismatch");
    SC.CanonicalBase64.parse(file.contentBase64);
    const size = SC.decodedBase64Size(file.contentBase64);
    total += size;
    // Existing transport budget, not a new product artifact quota.
    if (size !== file.sizeBytes || size > S.limits.maxFileBytes || total > S.limits.maxRequestBytes) throw new Error("native_output_size");
    const bytes = Buffer.from(file.contentBase64, "base64");
    const hash = digest(bytes);
    const name = path.slice(path.lastIndexOf("/") + 1);
    const mime = outputFileMime(name);
    const key = `agent-run-outputs/${digest(input.runId)}/${hash}/${encodeURIComponent(name)}`;
    try { await deps.objects.putOnce(key, bytes, mime); }
    catch (error) { if (!(error instanceof ObjectExistsError)) throw error; }
    const stored = await deps.objects.get(key);
    if (!stored || stored.length !== size || digest(stored) !== hash) throw new Error("native_output_readback_mismatch");
    files.push({ name, mime, sizeBytes: size, objectKey: key });
  }
  return files;
}
