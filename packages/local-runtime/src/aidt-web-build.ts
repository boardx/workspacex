/** AIDT-only proof of a compatible, unchanged Next build. Ordinary Local is unchanged. */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { webEnv, type LocalConfig } from "./config";

export interface AidtWebBuildFingerprint { schema: 1; distDir: string; apiURL: string; publicEnv: Record<string, string>; sourceInputHash: string }
export interface AidtWebBuildReceipt extends AidtWebBuildFingerprint { buildId: string; runtimeArtifactHash: string }
export interface AidtWebBuildCheck { usable: boolean; reason: string | null }
const RECEIPT = "aidt-local-build-receipt.json";
const OUTPUT_OWNER = ".aidt-local-output-owner.json";
const GENERATED_DIRS = new Set(["node_modules", "dist", "out", "coverage", "test-results", "playwright-report", "blob-report", ".turbo", ".git", ".cache", "__tests__", "test", "tests", "e2e"]);
function normalized(path: string): string { return path.split(sep).join("/"); }
function sourceExcluded(name: string): boolean {
  return GENERATED_DIRS.has(name) || name.startsWith(".next") || name === OUTPUT_OWNER || name === RECEIPT || name.startsWith(".env") || name.endsWith(".tsbuildinfo") || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name);
}
function webRoot(repoRoot: string): string { return join(realpathSync(resolve(repoRoot)), "apps", "web"); }
function environment(c: LocalConfig): { root: string; output: string; distDir: string; apiURL: string; publicEnv: Record<string, string> } {
  const env = webEnv(c), distDir = env.NEXT_DIST_DIR;
  if (c.profile !== "aidt" || !distDir || isAbsolute(distDir) || basename(distDir) !== distDir || distDir === "." || distDir === "..") throw new Error("AIDT prebuild requires the explicit AIDT Local profile and its configured output directory.");
  const publicEnv = Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith("NEXT_PUBLIC_")).sort(([a], [b]) => a.localeCompare(b)));
  if (!env.NEXT_PUBLIC_API_URL || !Object.entries(publicEnv).filter(([key]) => key.startsWith("NEXT_PUBLIC_ENABLE_")).every(([, value]) => value === "1")) throw new Error("AIDT browser feature switches must be enabled for a prebuilt teaching workspace.");
  const root = webRoot(c.repoRoot), output = join(root, distDir);
  return { root, output, distDir, apiURL: env.NEXT_PUBLIC_API_URL, publicEnv };
}
function filesUnder(root: string, dir: string, excluded: (name: string, file: string) => boolean, files: string[]): void {
  if (!existsSync(dir)) throw new Error(`Missing build input: ${relative(root, dir)}`);
  const directory = lstatSync(dir);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error(`Cannot verify a symlinked/non-directory build input: ${relative(root, dir)}`);
  for (const entry of readdirSync(dir).sort()) {
    const file = join(dir, entry);
    if (excluded(entry, file)) continue;
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error(`Cannot verify a symlinked build input: ${relative(root, file)}`);
    if (stat.isDirectory()) filesUnder(root, file, excluded, files);
    else if (stat.isFile()) files.push(file);
    else throw new Error(`Cannot verify non-file build input: ${relative(root, file)}`);
  }
}
/** Length-framed paths plus chunked file bytes detect new/deleted/renamed files without huge reads. */
function hashFiles(root: string, files: readonly string[]): string {
  const hash = createHash("sha256"), buffer = Buffer.allocUnsafe(64 * 1024);
  for (const file of [...files].sort((a, b) => normalized(relative(root, a)).localeCompare(normalized(relative(root, b))))) {
    const name = normalized(relative(root, file)), before = lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink()) throw new Error(`Cannot verify a symlinked/non-file build input: ${name}`);
    hash.update(`${Buffer.byteLength(name)}:${name}:${before.size}:`);
    const fd = openSync(file, "r");
    try { let count: number; while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count)); }
    finally { closeSync(fd); }
    const after = lstatSync(file);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error(`Build input changed while checking: ${name}`);
  }
  return hash.digest("hex");
}
function sourceHash(repoRoot: string): string {
  const root = realpathSync(resolve(repoRoot)), files: string[] = [];
  filesUnder(root, join(root, "apps", "web"), (name, file) => sourceExcluded(name) || normalized(relative(root, file)) === "apps/web/public/monaco-editor", files);
  // next.config.mjs imports build support from e2e; this remains a real input
  // while test suites and their generated output stay outside the source hash.
  const buildSupport = join(root, "apps", "web", "e2e", "support");
  if (existsSync(buildSupport)) filesUnder(root, buildSupport, sourceExcluded, files);
  filesUnder(root, join(root, "packages"), sourceExcluded, files);
  // Root dependency/toolchain inputs affect Next even when application sources are unchanged.
  for (const name of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", ".npmrc", ".nvmrc", ".node-version", "turbo.json"]) if (existsSync(join(root, name))) files.push(join(root, name));
  // Next production reads these dotenv inputs even with explicit API/module overrides.
  // Digest bytes only; no values are retained in receipts, logs or error messages.
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    const file = join(root, "apps", "web", name);
    try { requireRegularFile(file, "dotenv input"); files.push(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return hashFiles(root, files);
}
function requireRegularFile(file: string, label: string): void {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Cannot verify a symlinked/non-file AIDT ${label}.`);
}
function artifact(c: LocalConfig): { buildId: string; runtimeArtifactHash: string } {
  const { output } = environment(c), files: string[] = [];
  if (!existsSync(output) || lstatSync(output).isSymbolicLink()) throw new Error("AIDT production output is missing or symlinked; build it first.");
  const buildFile = join(output, "BUILD_ID"); requireRegularFile(buildFile, "BUILD_ID");
  const buildId = readFileSync(buildFile, "utf8").trim();
  if (!buildId || buildId.length > 256 || /[\u0000-\u001f\\/]/.test(buildId)) throw new Error("AIDT BUILD_ID is missing or invalid.");
  for (const required of ["build-manifest.json", "required-server-files.json"]) {
    const manifest = join(output, required); requireRegularFile(manifest, "manifest");
    const value: unknown = JSON.parse(readFileSync(manifest, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`AIDT runtime manifest is invalid: ${required}`);
  }
  for (const name of ["server", "static"]) {
    const before = files.length;
    filesUnder(output, join(output, name), (entry) => ["cache", "trace", "types", "standalone"].includes(entry), files);
    if (before === files.length) throw new Error(`AIDT ${name} output is empty.`);
  }
  for (const name of readdirSync(output)) {
    if (name === "BUILD_ID" || name === "required-server-files.json" || name === "package.json" || /manifest.*\.json$/.test(name)) {
      const file = join(output, name), stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Invalid AIDT runtime output: ${name}`);
      files.push(file);
    }
  }
  // Next config copies Monaco into public on a fresh build. It is generated source-wise,
  // but is browser runtime output and must be bound to the same receipt.
  const monaco = join(environment(c).root, "public", "monaco-editor");
  if (existsSync(monaco)) filesUnder(output, monaco, () => false, files);
  return { buildId, runtimeArtifactHash: hashFiles(output, files) };
}
export function fingerprintAidtWebBuild(c: LocalConfig): AidtWebBuildFingerprint {
  const { distDir, apiURL, publicEnv } = environment(c);
  return { schema: 1, distDir, apiURL, publicEnv, sourceInputHash: sourceHash(c.repoRoot) };
}
export function invalidateAidtWebBuild(c: LocalConfig): void {
  const file = join(environment(c).output, RECEIPT);
  try { unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
/** Call only after Next exits successfully; invalidate before launching build as well. */
export async function recordAidtWebBuild(c: LocalConfig, expectedInput?: AidtWebBuildFingerprint): Promise<void> {
  invalidateAidtWebBuild(c);
  const fingerprint = fingerprintAidtWebBuild(c);
  if (expectedInput && JSON.stringify(expectedInput) !== JSON.stringify(fingerprint)) throw new Error("AIDT source or configuration changed during the build. Rebuild before recording success.");
  const runtime = artifact(c);
  const receipt: AidtWebBuildReceipt = { ...fingerprint, ...runtime };
  // Recheck source after hashing the compiled output; edits during verification are never blessed.
  if (sourceHash(c.repoRoot) !== receipt.sourceInputHash) throw new Error("AIDT source changed while recording the build. Rebuild before starting.");
  const file = join(environment(c).output, RECEIPT), temporary = `${file}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 }); renameSync(temporary, file); }
  finally { try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
}
export function checkAidtWebBuild(c: LocalConfig): AidtWebBuildCheck {
  try {
    const file = join(environment(c).output, RECEIPT);
    if (!existsSync(file)) return { usable: false, reason: "AIDT build receipt is missing. Run the AIDT local build command, or start in dev mode." };
    requireRegularFile(file, "receipt");
    const receipt = JSON.parse(readFileSync(file, "utf8")) as Partial<AidtWebBuildReceipt>;
    const expected = fingerprintAidtWebBuild(c);
    if (receipt.schema !== 1 || receipt.distDir !== expected.distDir || receipt.apiURL !== expected.apiURL || JSON.stringify(receipt.publicEnv) !== JSON.stringify(expected.publicEnv)) return { usable: false, reason: "AIDT build API address, browser switches or output profile changed. Rebuild for this local configuration." };
    if (receipt.sourceInputHash !== expected.sourceInputHash) return { usable: false, reason: "AIDT source or dependency inputs changed. Rebuild before using prebuilt start." };
    const current = artifact(c);
    if (receipt.buildId !== current.buildId || receipt.runtimeArtifactHash !== current.runtimeArtifactHash) return { usable: false, reason: "AIDT runtime build output changed or is incomplete. Rebuild before using prebuilt start." };
    return { usable: true, reason: null };
  } catch (error) { return { usable: false, reason: error instanceof Error ? error.message : "AIDT build verification failed." }; }
}
/** Repository-wide output ownership spans all data directories; never signals or adopts stale PIDs. */
export async function acquireWebOutputLease(repoRoot: string): Promise<{ close(): Promise<void> }> {
  const root = webRoot(repoRoot); mkdirSync(root, { recursive: true });
  const file = join(root, OUTPUT_OWNER), instanceId = randomUUID();
  let fd: number;
  try { fd = openSync(file, "wx", 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("AIDT web output is already owned or has a stale lock. Stop its dev/start/build owner first; no process or file was removed."); throw error; }
  try { writeFileSync(fd, JSON.stringify({ schema: 1, instanceId, pid: process.pid, startedAt: new Date().toISOString() })); } finally { closeSync(fd); }
  let closing: Promise<void> | undefined;
  return { close() { closing ??= (async () => {
    if (!existsSync(file)) return;
    const current = JSON.parse(readFileSync(file, "utf8")) as { instanceId?: string };
    if (current.instanceId === instanceId) unlinkSync(file);
  })(); return closing; } };
}
