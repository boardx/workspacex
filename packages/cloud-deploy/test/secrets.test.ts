import { mkdtemp, writeFile, chmod, symlink, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { resolveSecret, ensureDeploymentSecret } from "../src/secrets";
const dirs: string[] = [];
async function dir() { const p = await mkdtemp(join(tmpdir(), "deploy-secret-")); dirs.push(p); return p; }
afterEach(async () => { await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
it("resolves environment values exactly without printing them in errors", async () => {
  expect(await resolveSecret("env:KEY", { KEY: "line1\nline2" })).toBe("line1\nline2");
  await expect(resolveSecret("env:KEY", {})).rejects.toThrow(/^SECRET_UNAVAILABLE$/);
  await expect(resolveSecret("raw-secret-password", {})).rejects.toThrow(/^INVALID_SECRET_REFERENCE$/);
});
it("reads only private regular files and refuses symlinks or public permissions", async () => {
  const root = await dir(); const path = join(root, "key");
  await writeFile(path, "private-key", { mode: 0o600 });
  expect(await resolveSecret(`file:${path}`)).toBe("private-key");
  const alias = join(root, "alias"); await symlink(path, alias);
  await expect(resolveSecret(`file:${alias}`)).rejects.toThrow("SECRET_UNAVAILABLE");
  await chmod(path, 0o644);
  await expect(resolveSecret(`file:${path}`)).rejects.toThrow("SECRET_UNAVAILABLE");
  await expect(resolveSecret(`file:${root}`)).rejects.toThrow("SECRET_UNAVAILABLE");
});
it("bounds file sizes and rejects empty or malformed text", async () => {
  const path = join(await dir(), "key");
  for (const value of [Buffer.alloc(0), Buffer.alloc(65537, 65), Buffer.from([255]), Buffer.from([0])]) {
    await writeFile(path, value, { mode: 0o600 });
    await expect(resolveSecret(`file:${path}`)).rejects.toThrow("SECRET_UNAVAILABLE");
  }
});
it("concurrent initializations and retries preserve exactly one secret", async () => {
  const root = await dir();
  const values = await Promise.all(Array.from({ length: 8 }, () => ensureDeploymentSecret(root, "session-key")));
  expect(new Set(values).size).toBe(1); expect(values[0]).toMatch(/^[a-f0-9]{64}$/);
  expect(await ensureDeploymentSecret(root, "session-key")).toBe(values[0]);
  expect(await readdir(root)).toEqual(["session-key"]);
});
it("never replaces a damaged existing secret", async () => {
  const root = await dir(); const path = join(root, "session-key");
  await writeFile(path, "damaged", { mode: 0o600 });
  await expect(ensureDeploymentSecret(root, "session-key")).rejects.toThrow("SECRET_INVALID");
  expect(await readFile(path, "utf8")).toBe("damaged");
});
it("refuses unsafe names and directories", async () => {
  const root = await dir();
  await expect(ensureDeploymentSecret(root, "../escape")).rejects.toThrow("INVALID_SECRET_NAME");
  await chmod(root, 0o755);
  await expect(ensureDeploymentSecret(root, "key")).rejects.toThrow("UNSAFE_SECRET_DIRECTORY");
});
